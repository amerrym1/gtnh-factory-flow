/**
 * Reactors and free-energy machines: THTR, HTGR, LFTR, the IC2 fluid
 * reactor presets, DEHP and the Solar Tower. Formulas from
 * docs/power-planner-math.md; where the workbook leaves a cost out (IC2
 * rods), the card says so instead of pretending.
 */
import { powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, items, liters, percent, stat, tierPower } from "./helpers";

const thtr: PowerSourceDefinition = {
  id: "thtr",
  name: "Thorium High Temperature Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Thorium pebbles to hot coolant; partial fills are brutal.",
  settings: [
    {
      type: "number",
      id: "fill",
      label: "Pebble fill",
      min: 100_000,
      max: 675_000,
      step: 1000,
      defaultValue: 675_000,
    },
  ],
  compute(read): PowerModel {
    const fill = read.number("fill");
    const efficiency = Math.min(1, 0.01 + Math.pow((fill - 100_000) / 57_500, 2) / 100);
    const pebbleCost = Math.floor(fill * 0.005 * efficiency);
    const hotCoolantPerSecond = 4800 * efficiency * 20;
    return {
      euPerTick: -3840 / efficiency,
      inputs: [liters("IC2 Coolant", hotCoolantPerSecond)],
      outputs: [liters("IC2 Hot Coolant", hotCoolantPerSecond)],
      stats: [
        stat("Efficiency", percent(efficiency)),
        stat("Pebbles per cycle", formatAmount(pebbleCost)),
        stat("Hot coolant", `${formatAmount(hotCoolantPerSecond / 20)} L/t`),
      ],
    };
  },
};

const htgr: PowerSourceDefinition = {
  id: "htgr",
  name: "High Temperature Gas-cooled Reactor",
  group: "reactors",
  unlock: "IV",
  blurb: "TRISO pebbles to hot coolant and steam at once.",
  settings: [
    {
      type: "select",
      id: "pebble",
      label: "TRISO pebble",
      options: powerPlannerData.htgrPebbles.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.htgrPebbles[0]?.name ?? "",
    },
    { type: "number", id: "fill", label: "Pebble fill", min: 1, max: 10_000, step: 100, defaultValue: 10_000 },
  ],
  compute(read): PowerModel {
    const pebble =
      powerPlannerData.htgrPebbles.find((entry) => entry.name === read.select("pebble")) ??
      powerPlannerData.htgrPebbles[0];
    const fill = read.number("fill");
    const x = fill / 10_000;
    const efficiency = Math.min(1, 0.1 + 0.9 * (1 - Math.pow(1 - x, 3)));
    const multiplier = pebble.base * x * Math.pow(1 + (pebble.mult - 1) * x, 1 + (pebble.exp - 1) * x);
    const pebbleCost = fill * (Math.PI - 3) * 0.01 * efficiency;
    const hotCoolantPerSecond = 0.5 * fill * multiplier;
    const steamPerTick = 0.1 * fill * multiplier * 160;
    return {
      euPerTick: -1536,
      inputs: [liters("IC2 Coolant", hotCoolantPerSecond)],
      outputs: [liters("IC2 Hot Coolant", hotCoolantPerSecond), liters("Steam", steamPerTick * 20)],
      stats: [
        stat("Efficiency", percent(efficiency)),
        stat("Output multiplier", formatAmount(multiplier)),
        stat("Pebbles per cycle", formatAmount(pebbleCost)),
      ],
    };
  },
};

const lftr: PowerSourceDefinition = {
  id: "lftr",
  name: "Liquid Fluoride Thorium Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Burns bred fuel salts for direct EU and sparged byproducts.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: powerPlannerData.lftrFuels.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.lftrFuels[0]?.name ?? "",
    },
  ],
  compute(read): PowerModel {
    const fuel =
      powerPlannerData.lftrFuels.find((entry) => entry.name === read.select("fuel")) ??
      powerPlannerData.lftrFuels[0];
    // 16 amps of the fuel's base tier: "Net Amps (EV)" names the tier.
    const tierName = fuel.powerLabel.match(/\(([A-Z]+)\)/)?.[1] ?? "EV";
    const euPerTick = tierPower(tierName).voltage * 16;
    const outputs = [
      liters("U-Salt", fuel.uSalt / 100),
      liters("T-Salt", fuel.tSalt / 100),
      liters("TB-Salt", fuel.tbSalt / 100),
      liters("UF6", fuel.uf6 / 100),
      liters("Molten Uranium 233", fuel.uranium233PerSecond),
    ].filter((flow) => flow.perSecond > 0);
    return {
      euPerTick,
      inputs: [liters(fuel.name, 1)],
      outputs,
      stats: [stat("EU per L", formatAmount(fuel.euPerLiter))],
    };
  },
};

const IC2_DESIGNS = [
  { key: "design-1", label: "Design 1 (1,150 L/s)", rate: 1150 },
  { key: "design-2", label: "Design 2 (1,380 L/s)", rate: 1380 },
  { key: "design-3", label: "Design 3 (1,340 L/s)", rate: 1340 },
];

const ic2FluidReactor: PowerSourceDefinition = {
  id: "ic2-fluid-reactor",
  name: "Nuclear Reactor (fluid mode)",
  group: "reactors",
  unlock: "EV",
  blurb: "A preset rod layout heating coolant; rod costs are not modeled.",
  settings: [
    {
      type: "select",
      id: "design",
      label: "Reactor design",
      options: [...IC2_DESIGNS.map(({ key, label }) => ({ key, label })), { key: "custom", label: "Custom rate" }],
      defaultKey: "design-2",
    },
    {
      type: "number",
      id: "customRate",
      label: "Hot coolant rate",
      min: 1,
      max: 100_000,
      step: 10,
      defaultValue: 1380,
      unit: "L/s",
    },
  ],
  compute(read): PowerModel {
    const design = IC2_DESIGNS.find((entry) => entry.key === read.select("design"));
    const rate = design?.rate ?? read.number("customRate");
    return {
      euPerTick: 0,
      inputs: [liters("IC2 Coolant", rate)],
      outputs: [liters("IC2 Hot Coolant", rate)],
      stats: [stat("Hot coolant", `${formatAmount(rate)} L/s`)],
      warnings: ["Uranium rod costs are not modeled; the community planner skips them too."],
    };
  },
};

const dehp: PowerSourceDefinition = {
  id: "dehp",
  name: "Deep Earth Heating Pump",
  group: "reactors",
  unlock: "EV",
  blurb: "Geothermal: water in, superheated steam or hot coolant out.",
  settings: [
    {
      type: "select",
      id: "mode",
      label: "Mode",
      options: [
        { key: "steam", label: "Direct steam" },
        { key: "coolant", label: "Coolant heating" },
      ],
      defaultKey: "steam",
    },
  ],
  compute(read): PowerModel {
    if (read.select("mode") === "coolant") {
      const perSecond = 192 * 20;
      return {
        euPerTick: -480,
        inputs: [liters("IC2 Coolant", perSecond)],
        outputs: [liters("IC2 Hot Coolant", perSecond)],
        stats: [stat("Hot coolant", "192 L/t")],
      };
    }
    const steamPerTick = 25_600;
    return {
      euPerTick: -480,
      inputs: [liters("Distilled Water", (steamPerTick / 160) * 20)],
      outputs: [liters("SH Steam", steamPerTick * 20)],
      stats: [stat("Steam", `${formatAmount(steamPerTick)} L/t superheated`)],
    };
  },
};

const SOLAR_TOWER_RINGS = [
  { rings: 1, hotSalt: 38.6 },
  { rings: 2, hotSalt: 104.6 },
  { rings: 3, hotSalt: 217.4 },
  { rings: 4, hotSalt: 431 },
  { rings: 5, hotSalt: 883 },
];

const solarTower: PowerSourceDefinition = {
  id: "solar-tower",
  name: "Solar Tower",
  group: "passive",
  unlock: "EV",
  blurb: "Heliostats heat solar salt for the exchangers. No fuel at all.",
  settings: [
    {
      type: "select",
      id: "rings",
      label: "Heliostat rings",
      options: SOLAR_TOWER_RINGS.map((entry) => ({
        key: String(entry.rings),
        label: `${entry.rings} ${entry.rings === 1 ? "ring" : "rings"}`,
      })),
      defaultKey: "5",
    },
  ],
  compute(read): PowerModel {
    const rings = Number(read.select("rings"));
    const entry = SOLAR_TOWER_RINGS.find((row) => row.rings === rings) ?? SOLAR_TOWER_RINGS[4];
    const heliostats = (28 + 8 * rings) * rings;
    return {
      euPerTick: 0,
      inputs: [liters("Solar Salt (Cold)", entry.hotSalt)],
      outputs: [liters("Solar Salt (Hot)", entry.hotSalt)],
      stats: [
        stat("Heliostats", String(heliostats)),
        stat("Hot salt", `${formatAmount(entry.hotSalt)} L/s`),
      ],
    };
  },
};

/** Panel EU/t doubles the classic ladder; values are the GT panel blocks. */
const SOLAR_PANEL_TIERS = [
  { key: "ULV", label: "Solar Panel (1 EU/t)", eut: 1 },
  { key: "LV", label: "LV Solar Panel (8 EU/t)", eut: 8 },
  { key: "MV", label: "MV Solar Panel (32 EU/t)", eut: 32 },
  { key: "HV", label: "HV Solar Panel (128 EU/t)", eut: 128 },
  { key: "EV", label: "EV Solar Panel (512 EU/t)", eut: 512 },
  { key: "IV", label: "IV Solar Panel (2,048 EU/t)", eut: 2048 },
  { key: "LuV", label: "LuV Solar Panel (8,192 EU/t)", eut: 8192 },
  { key: "ZPM", label: "ZPM Solar Panel (32,768 EU/t)", eut: 32768 },
  { key: "UV", label: "UV Solar Panel (131,072 EU/t)", eut: 131072 },
];

const solarPanel: PowerSourceDefinition = {
  id: "solar-panel",
  name: "Solar Panel",
  group: "passive",
  unlock: "MV",
  blurb: "Flat daytime EU from sunlight. The duty knob prices the night.",
  settings: [
    {
      type: "select",
      id: "panel",
      label: "Panel",
      options: SOLAR_PANEL_TIERS.map(({ key, label }) => ({ key, label })),
      defaultKey: "LV",
    },
    { type: "number", id: "duty", label: "Duty", min: 1, max: 100, step: 1, defaultValue: 100, unit: "%" },
  ],
  compute(read): PowerModel {
    const panel = SOLAR_PANEL_TIERS.find((entry) => entry.key === read.select("panel")) ?? SOLAR_PANEL_TIERS[1];
    const duty = read.number("duty") / 100;
    return {
      euPerTick: panel.eut * duty,
      inputs: [],
      outputs: [],
      stats: [stat("Daytime output", `${formatAmount(panel.eut)} EU/t`)],
    };
  },
};

export const reactorSources: PowerSourceDefinition[] = [thtr, htgr, lftr, ic2FluidReactor, dehp];
export const passiveSources: PowerSourceDefinition[] = [solarTower, solarPanel];
