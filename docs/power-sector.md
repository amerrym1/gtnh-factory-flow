# The Power Sector

A spec for making power a first-class part of the planner: generators as
placeable cards that burn real fuel, a plan-wide power ledger, and (opt-in,
later) power as a resource the solver balances. Drafted 2026-08-30 from the
player feedback below, the GTNH wiki's Electricity / Power Generation pages,
and an audit of what the dataset and solver already carry.

Status: SPEC ONLY. Nothing here is built.

## What players are asking for

Two distinct requests, from Discord:

1. "Can I calculate fuel spendings? Output here is wrong because I use benzene
   to produce more benzene." - The books count the benzene his pyrolyse line
   makes, but nothing on the board burns it, so the plan's "output" is gross,
   not net of the power bill. He wants generators on the board eating fuel.
2. "How do I give power to a machine in the planner?" - Machines report EU/t
   in the bottom-right summary, but there is no way to SUPPLY it, so a plan
   never answers "am I making enough power for this."

Also asked directly: "is there a way to count the EU output of fuels in
generators yet?" - the recipe book cannot show what a fuel is worth.

## The key finding: the data already exists

The raw oracle export (`.pipeline/raw-export/local-2.9.0-beta-2/`) already
contains GT's eight fuel recipe maps, exported like any other map, with real
item entries, icons, and machine catalysts:

| Map id | NEI name | Recipes | Catalysts |
| --- | --- | --- | --- |
| `gt.recipe.dieselgeneratorfuel` | Combustion Generator Fuels | 20 | 9 |
| `gt.recipe.extremedieselgeneratorfuel` | Extreme Diesel Engine Fuel | 3 | 2 |
| `gt.recipe.gasturbinefuel` | Gas Turbine Fuel | 28 | 11 |
| `gt.recipe.plasmageneratorfuels` | Plasma Generator Fuels | 113 | 9 |
| `gt.recipe.semifluidboilerfuels` | Semifluid Boiler Fuels | 15 | 0 |
| `gt.recipe.largeboilerfakefuels` | Large Boiler | 76 | 8 |
| `gt.recipe.thermalgeneratorfuel` | Thermal Generator Fuels | 5 | 3 |
| `gt.recipe.magicfuels` | Magic Energy Absorber Fuels | 110 | 7 |

That is ~370 fuel entries. Each is shaped like a GT fuel registration: one
item input (the fuel CELL or bucket - GT registers fuels in cell form), no
outputs, `durationTicks: 1`, `eut: 0`, and the fuel value in `specialValue`
(NEI's "Fuel Value", EU per 1000 mB - Ether 537 means 537,000 EU per cell).
The singleblock Naquadah Reactors Mk I-V export the same way in their own
maps. Fusion is ALREADY a normal dataset map (EU in, plasma out), so the
plasma power loop closes the moment Plasma Generator Fuels lands.

They never reach the published dataset because of exactly two lines in
`tools/dataset-pipeline/scripts/normalize-oracle-export.mjs`:

- `if (outputs.length === 0) continue;` - a fuel recipe has no outputs, so
  every one of them is dropped.
- `eut = Math.max(0, ...)` - generation (negative EU) cannot be expressed.

So no new Minecraft export is needed. This is a pipeline + app project, not
an oracle project, and the expensive raw exports we already have carry it.

## Doctrine

Extending the solver doctrine (docs/solver-equations.md) to power:

1. **A generator is a machine.** It wears a recipe card, its fuel arrives on
   ordinary wires, its consumption enters the books like any input. No
   special fuel-profile arithmetic on the side (the current
   `fuels.ts` estimate - total EU divided by one hardcoded fuel value -
   retires when real generators exist).
2. **Power is a bus, not a wire, by default.** EU does not travel on drawn
   edges. Generators pay into a plan-wide pool, machines draw from it, and
   the power panel shows the ledger. Reasons below ("Why not wires").
3. **Rates are nameplate.** As everywhere else in the planner, a generator
   card's figures are full-speed: what that hardware burns and makes at full
   load. Demand-coupling (generators idling when the plan needs less) is the
   strict mode's job, in the LP, later.
4. **Additive, never breaking.** A plan with no generator cards solves
   exactly as today. Power shortage is a red line in the ledger, not a stall,
   unless the player opts into strict power (Phase 3).
5. **Voltage tiers are reporting, not plumbing.** In game any EU reaches any
   machine through transformers at small loss, so the pool is fungible EU/t.
   The per-tier breakdown stays in the panel; per-node tier checks
   (under-powered / over-tier in power-report.ts) already exist and stand.

## Why not wires (at first)

Jack's opening question was "what if you had to wire power to each thing."
Recommendation: not as the foundation, for three reasons.

- **Fan-out noise.** Every electric card needs power, so honest wiring is one
  edge from a generator to EVERY card - a star that buries the material
  wires the board exists to show. GT players think in networks and
  substations, not point-to-point runs.
- **It is not how the game works either.** Cables form a shared network;
  machines pull amps from whatever is attached. The bus IS the faithful
  model. Cable choice, loss and amperage are real mechanics, but they are
  per-meter and per-network-topology facts the planner has no geometry for.
- **The feedback does not ask for it.** Both players want the accounting
  (fuel burned, EU covered), not the drawing.

Explicit power wiring can still come later as a VIEW (Phase 4): once the
books know generation and draw, wires are presentation. If it ever lands, the
natural shapes are an EU chip on cards (reusing the whole edge machinery) or
boards as power networks. Decide then, not now.

## Phase 1 - Generators are cards, the panel becomes a ledger

The smallest release that answers all three quotes. No solver change at all.

### Pipeline

- Stop dropping fuel maps. In `normalize-oracle-export.mjs`, recipes from the
  eight fuel maps (plus the Naquadah Reactor Mk I-V maps) normalize into
  generator recipes instead of hitting the zero-output filter:
  - Input: the fuel as exported (cell/bucket item form).
  - Output: the EMPTY container back. The game returns the emptied cell;
    Cells Are Items doctrine says so must we.
  - A synthesized FLUID twin per cell fuel: 1000 L of the fluid in, no cell.
    Generators drink piped fluid in game; producers on a board make fluid,
    not cells. Same precedent as `addTankRecipe` (mirror a map into the form
    players actually wire). Solid fuels (Large Boiler dust/block entries,
    magic items) have no twin.
  - A new recipe field carries the energy: `fuel: { euTotal }` where
    `euTotal = specialValue * 1000` for the per-1000mB maps. NO eut hack, no
    negative numbers through the existing `Math.abs(eut)` paths.
- Map semantics to pin from GT5U source during build (each with a test):
  - `FuelBackend` / each generator's consumption code, confirming
    specialValue units per map. The Large Boiler map is NOT per-cell EU (its
    entries are burn-value scaled; charcoal dust exports specialValue 1) and
    boilers output STEAM, not EU - it belongs to Phase 2.
  - Ash/byproduct returns where the game gives them (large boilers).
- Machine families merge as usual: the maps already export catalysts
  (Combustion Generator Fuels lists 9 machines), so handler templates,
  machine tabs and icons come free from existing machinery.
- Dataset rebuild + publish via the normal WSL flow.

### Generator behaviour (curated, like machine-table)

A fuel recipe says how much energy a fuel HOLDS. What a machine does with it
is machine behaviour, and it goes in `machine-table.ts` style entries,
transcribed from GT5U source (C:\Users\jack\gtnh-sources\GT5-Unofficial - the
ShadowTheAge reference barely covers generators, so source is the reference
here), each pinned by a fixture test:

- **Singleblock generators** (diesel, gas turbine, steam turbine, semifluid,
  thermal, plasma, magic absorber, naq reactors): output 1A of their tier
  while running, with a per-tier efficiency percent from each MTE. Handler
  stats synthesize like the steam singleblocks precedent in
  `recipe-rules.ts`: EU/t out = tier voltage, duration = euTotal x
  efficiency / EU/t. The card then reads like any machine card: fuel L/s in,
  EU/t out, count scales it.
- **Multiblock generators**: Large Combustion Engine and Extreme Combustion
  Engine (boost mechanics: oxygen / liquid oxygen consumption multiplying
  output, from source), Large Gas Turbine and XL Turbo Gas Turbine, plasma
  turbines. Turbine rotors are Phase 2; until a rotor catalog exists, large
  turbines carry a plain efficiency knob (a `MachineConfigControl`, default
  from source) so they are usable without lying.

### App model

- `Recipe.fuel` flows through schemas, import/export, and
  `getNodeGeneratorReport` (new, in power-report.ts): EU/t produced at the
  node's handler/tier/count, nameplate.
- The card's power section shows PRODUCES with the EU/t and tier where
  consumers show the draw. The outputs column shows the empty cell / nothing;
  EU is NOT a port in Phase 1 (a footer stat, like steam litres).
- **The power panel becomes a ledger.** Bottom-right today: draw by tier +
  the fuels.ts estimate. It becomes:
  - Consumption by tier (unchanged).
  - Generation, one line per generator group, with EU/t.
  - A net line: covered / short by N EU/t, red when short. Plain copy, e.g.
    "Makes 1,920 EU/t. Needs 2,440 EU/t. Short 520 EU/t."
  - The fuel-profile estimate row retires (`fuels.ts`,
    `calculateFuelEstimate`, the profile picker). Migration keeps old plans
    loading (profiles already normalize; they just stop rendering).
- **Recipe book**: the fuel maps appear as ordinary machine chips. Right-click
  benzene -> "Gas Turbine Fuel" chip with a count - literally the first
  quote's request. Fuel cards render the fuel value ("537,000 EU per cell")
  where a normal card shows outputs.
- Steam is NOT double-billed: steam machines keep paying litres
  (`getNodeSteamReport`), electric machines pay EU, turbines burn steam
  litres to MAKE EU. One resource changes hands at each step, as in game.

### What ships (changelog view)

Players can place generators, wire fuel to them, and see net fuel and whether
the plan's power is covered. The benzene board finally reports net benzene.

## Phase 2 - The steam economy and the endgame loops

- **Boilers.** Singleblock boilers are coded constants (Small Coal 120 L/s,
  HP Coal 300 L/s, solar/lava variants, GT++ advanced boilers) - synthesized
  recipes, the steam-singleblock precedent again. Large Boilers use the
  exported Large Boiler map: fuel in, steam L/s out by boiler tier, from
  source formulas. Railcraft boilers only if cheap; their fuel formula is
  gnarly and they are not the meta.
- **Turbine rotors.** A curated rotor catalog (material -> optimal flow,
  efficiency, tightness) as a `MachineConfigControl` on large/XL steam, gas
  and plasma turbines, replacing the Phase 1 efficiency knob. Transcribed
  from source with a fixture test; the rotor list is long, so start with the
  materials players actually run and grow it.
- **Large Heat Exchanger family** (LHE, XL, Extreme): hot fluid in, steam
  out - real recipe maps where exported, curated where coded.
- **Naquadah reactors** Mk I-V from their exported maps; the GT++ Large
  Naquadah Reactor (coolants, boosters) if its map exports cleanly.
- Fusion -> plasma -> plasma turbine now closes end to end; verify one
  helium-plasma board against wiki numbers as the acceptance test.

## Phase 3 - Strict power (opt-in): the books learn watts

A `SetupRules` toggle (pattern: `looseCellWires`), OFF by default. Suggested
name in the rules sheet: "Power on the board".

- EU becomes one row in the LP: sum of generator EU/t x act >= sum of
  machine draw x act. Every electric node gets an implicit EU input
  coefficient; generators get the supply coefficient. One row and one
  coefficient per node - negligible next to the existing model.
- **Shortage behaves like any starved input**: progressive max-min fairness
  throttles the plan honestly instead of letting it pretend. This is the
  game's brown-out, modeled the way equal-fill already models round-robin.
- Generators become demand-driven under strict power (they only burn what the
  plan draws - in game a generator stops burning when its buffer is full),
  so the benzene loop's fuel bill becomes the REAL bill, not nameplate.
- Board summaries gain the power line: a board that generates covers its own
  members first; NEEDS/MAKES show the border EU like any resource.
- The machine-count optimizer can now size generators ("how many turbines
  does this plan need"), because EU demand is finally a row it can see.
- Per-node power stalls (under-powered / over-tier) keep their existing
  meaning and stay pinned to act 0; the new row is about plan-wide supply.

## Phase 4 (maybe, and only after 3) - Drawing the power

If wires-you-can-see still feel wanted once the ledger and strict mode exist:
an EU chip on cards and dynamo chips on generators, riding the existing edge
system as presentation over the LP bus, or boards as named power networks.
Decide with fresh player feedback; do not pre-build for it.

## Explicit non-goals

Named so nobody "helpfully" adds them later:

- **Cables as entities**: materials, loss per meter, amperage limits, melt
  rules, cardinal push priority. The planner has no base geometry; any number
  would be invented. At most, far future: a flat configurable loss percent on
  the ledger.
- **Transformers, battery buffers, chargers, internal machine buffers.** The
  fungible pool subsumes transformers; buffers are time-domain devices and
  the books are steady-state.
- **Per-amp output loss** (the 2^(tier-1) EU a generator eats per packet).
  Real, sub-1% above LV, and it would complicate every figure. Note it in
  the ledger's tooltip at most.
- **RF/EU conversion.** One-way, niche for power planning.
- **IC2 nuclear reactor planning.** A whole simulator of its own; players
  have dedicated tools. If demanded later: curated cards for a few standard
  reactor layouts (EU/t + rod consumption), never an in-app reactor grid.
- **Day/night and weather simulation.** Solars, if added, get a plain duty
  factor knob, not a sun model.

## Open questions for Jack

1. **Phase 1 scope of machines**: singleblocks + LCE/ECE + large gas
   turbines feels right (covers oil, benzene, biodiesel players). Steam
   turbines too, or hold them for Phase 2 with boilers so steam lands whole?
2. **Solar and other passive sources**: worth synthesizing (no-input cards,
   constant EU/t with a duty knob), or leave out until asked?
3. **Ledger placement**: grow the existing bottom-right POWER panel, or is
   this the moment it becomes a proper side-panel section like MACHINES?
4. **Strict-mode default for NEW plans** once Phase 3 exists: stay opt-in
   forever, or flip on when the plan contains a generator card?
5. **The `fuels.ts` retirement**: any attachment to the fuel-profile picker,
   or does it go without ceremony in Phase 1?
