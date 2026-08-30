/**
 * Endgame power: the Large Naquadah Reactor, the fusion reactors as plasma
 * factories, the Eye of Harmony (simplified expected-value model) and the
 * Antimatter loop (closed-form optimum search instead of the workbook's
 * 3,235-row sweep).
 */
import { powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, liters, stat } from "./helpers";

const NONE = "None";

const lnr: PowerSourceDefinition = {
  id: "large-naquadah-reactor",
  name: "Large Naquadah Reactor",
  group: "endgame",
  unlock: "UHV",
  blurb: "Naquadah fuels times coolant times booster, on liquid air.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: powerPlannerData.lnrFuels.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: "Naq Fuel Mk-I",
    },
    {
      type: "select",
      id: "coolant",
      label: "Coolant",
      options: [
        { key: NONE, label: "None" },
        ...powerPlannerData.lnrCoolants
          .filter((entry) => entry.name !== NONE)
          .map((entry) => ({ key: entry.name, label: `${entry.name} (x${entry.efficiency})` })),
      ],
      defaultKey: NONE,
    },
    {
      type: "select",
      id: "booster",
      label: "Booster",
      options: [
        { key: NONE, label: "None" },
        ...powerPlannerData.lnrBoosters
          .filter((entry) => entry.name !== NONE)
          .map((entry) => ({ key: entry.name, label: `${entry.name} (x${entry.multiplier})` })),
      ],
      defaultKey: NONE,
    },
  ],
  compute(read): PowerModel {
    const fuel =
      powerPlannerData.lnrFuels.find((entry) => entry.name === read.select("fuel")) ??
      powerPlannerData.lnrFuels[0];
    const coolant = powerPlannerData.lnrCoolants.find((entry) => entry.name === read.select("coolant"));
    const booster = powerPlannerData.lnrBoosters.find((entry) => entry.name === read.select("booster"));
    const coolantEfficiency = coolant?.efficiency ?? 1;
    const boostMultiplier = booster?.multiplier ?? 1;
    const euPerTick = fuel.euPerTick * coolantEfficiency * boostMultiplier;
    // 1000 L of fuel lasts secondsPerCell; boosters burn it that much faster.
    const fuelPerSecond = (1000 * boostMultiplier) / fuel.secondsPerCell;

    const inputs = [liters(fuel.name, fuelPerSecond), liters("Liquid Air", 2400)];
    if (coolant && coolant.litersPerSecond > 0) {
      inputs.push(liters(coolant.name, coolant.litersPerSecond));
    }
    if (booster && booster.litersPerSecond > 0) {
      inputs.push(liters(booster.name, booster.litersPerSecond));
    }
    return {
      euPerTick,
      inputs,
      outputs: [],
      stats: [stat("Fuel", `${formatAmount(fuelPerSecond)} L/s`)],
    };
  },
};

function buildFusion(compact: boolean): PowerSourceDefinition {
  const marks = compact ? ["MK-I", "MK-II", "MK-III", "MK-IV", "MK-V"] : ["Mk-I", "Mk-II", "Mk-III", "Mk-IV", "Mk-V"];
  return {
    id: compact ? "compact-fusion-reactor" : "fusion-reactor",
    name: compact ? "Compact Fusion Reactor" : "Fusion Reactor",
    group: "endgame",
    unlock: compact ? "UEV" : "LuV",
    blurb: compact
      ? "The fusion recipes at roughly 64x the throughput and drain."
      : "Makes plasma for turbines; the card charges the reactor's own drain.",
    settings: [
      {
        type: "select",
        id: "recipe",
        label: "Plasma",
        options: powerPlannerData.fusionRecipes
          .filter((entry) => (entry.euPerLiter ?? 0) > 0)
          .map((entry) => ({ key: entry.name, label: entry.name })),
        defaultKey: "Helium Plasma",
      },
      {
        type: "select",
        id: "mark",
        label: "Mark",
        options: marks.map((mark, index) => ({ key: String(index + 1), label: mark })),
        defaultKey: "1",
      },
    ],
    compute(read): PowerModel {
      const recipe =
        powerPlannerData.fusionRecipes.find((entry) => entry.name === read.select("recipe")) ??
        powerPlannerData.fusionRecipes[0];
      const markIndex = Number(read.select("mark")) - 1;
      const output = (compact ? recipe.compactOutputLpsByMark : recipe.outputLpsByMark)[markIndex] ?? 0;
      const drain = (compact ? recipe.compactDrainEutByMark : recipe.drainEutByMark)[markIndex] ?? 0;
      const belowMark = markIndex + 1 < recipe.minMark || output <= 0;

      const inputs: PowerModel["inputs"] = [];
      if (!belowMark) {
        if (recipe.input1 && recipe.ratio1) {
          inputs.push(liters(recipe.input1, recipe.ratio1 * output));
        }
        if (recipe.input2 && recipe.ratio2) {
          inputs.push(liters(recipe.input2, recipe.ratio2 * output));
        }
      }
      return {
        euPerTick: belowMark ? 0 : -drain,
        inputs,
        outputs: belowMark ? [] : [liters(recipe.name, output)],
        stats: [
          stat("Plasma value", `${formatAmount(recipe.euPerLiter)} EU/L`),
          stat("Startup", `${formatAmount(recipe.startupEu)} EU`),
        ],
        warnings: belowMark
          ? [`${recipe.name} needs at least mark ${recipe.minMark}.`]
          : undefined,
      };
    },
  };
}

/**
 * Eye of Harmony, simplified: expected EU over a cycle at base upgrade
 * tiers, success chance shown as a stat. Almost always a net EU cost - the
 * EOH is a materials machine; this card exists so its bill lands in the
 * power summary honestly.
 */
const eoh: PowerSourceDefinition = {
  id: "eye-of-harmony",
  name: "Eye of Harmony",
  group: "endgame",
  unlock: "UV",
  blurb: "A materials machine with an enormous power bill, priced honestly.",
  settings: [
    {
      type: "select",
      id: "star",
      label: "Target block",
      options: powerPlannerData.eohStars.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.eohStars[0]?.name ?? "",
    },
  ],
  compute(read): PowerModel {
    const star =
      powerPlannerData.eohStars.find((entry) => entry.name === read.select("star")) ??
      powerPlannerData.eohStars[0];
    // Base upgrade tiers: EU-output efficiency 0.6, no overclocks.
    const netPerCycle = star.euOutput * 0.6 - star.euInput;
    const euPerTick = netPerCycle / star.durationTicks;
    return {
      euPerTick,
      inputs: [],
      outputs: [],
      stats: [
        stat("Cycle", `${formatAmount(star.durationTicks / 20)}s`),
        stat("Success", `${Math.round(star.baseSuccess * 100)}%`),
        stat("EU in", formatAmount(star.euInput)),
        stat("EU out", formatAmount(star.euOutput * 0.6)),
        stat("Star matter", formatAmount(star.starMatter)),
      ],
      warnings: ["Simplified model: base upgrade tiers, success assumed."],
    };
  },
};

/**
 * Antimatter: gain scales ~AM^0.55, costs ~AM^1.45, so there is one best
 * antimatter quantity - found here by golden-section search, which is what
 * the workbook's 3,235-row sweep approximates. Catalyst constants are the
 * workbook's defaults (Tengam / Spacetime / Shirabon / Depleted Mk-V).
 */
const AM_K = { magnetic: 0.1, gravity: 0.05, containment: 0.05, activation: 0.05 };
const AM_BURN_EU = Math.min(2 ** 63 - 1, 3.3554432e7 * 64 * 1048576 * 24);
const AM_PER_BURN_EXPONENT = 1.03;

function antimatterNetEuT(amPerSsass: number): number {
  const gainPerSecond = Math.pow(amPerSsass, 0.5 + AM_K.containment) * (0.2 + AM_K.activation);
  const amountPerBurn = Math.pow(AM_BURN_EU / 1e12, 1 / AM_PER_BURN_EXPONENT);
  const secondsPerBurn = amountPerBurn / gainPerSecond;
  const passiveCost = -(1e7 + Math.pow(amPerSsass * 1000, 1.5 - AM_K.magnetic));
  const activeCost = -Math.pow(amPerSsass * 10_000, 1.5 - AM_K.gravity) / 20;
  return AM_BURN_EU / (secondsPerBurn * 20) + passiveCost + activeCost;
}

function antimatterOptimum(): number {
  let low = 100;
  let high = 50_000_000;
  for (let i = 0; i < 80; i++) {
    const m1 = low + (high - low) * 0.382;
    const m2 = low + (high - low) * 0.618;
    if (antimatterNetEuT(m1) < antimatterNetEuT(m2)) {
      low = m1;
    } else {
      high = m2;
    }
  }
  return Math.round((low + high) / 2);
}

let cachedOptimum: number | undefined;

const antimatter: PowerSourceDefinition = {
  id: "antimatter",
  name: "Antimatter Forge",
  group: "endgame",
  unlock: "UMV",
  blurb: "Grows and burns antimatter; there is one best quantity to hold.",
  settings: [
    {
      type: "number",
      id: "amount",
      label: "Antimatter held",
      min: 0,
      max: 50_000_000,
      step: 1000,
      defaultValue: 0,
      unit: "L (0 = optimal)",
    },
  ],
  compute(read): PowerModel {
    const requested = read.number("amount");
    const optimum = (cachedOptimum ??= antimatterOptimum());
    const amount = requested > 0 ? requested : optimum;
    const euPerTick = antimatterNetEuT(amount);
    return {
      euPerTick,
      inputs: [
        liters("Molten Tengam", Math.pow(amount, 0.5)),
        liters("Molten SpaceTime", Math.pow(amount, 0.5)),
        liters("Molten Shirabon", Math.pow(amount, 2 / 7)),
        liters("Depleted Naquadah Fuel Mk V", Math.pow(amount, 1 / 3)),
      ],
      outputs: [],
      stats: [
        stat("Antimatter held", formatAmount(amount)),
        stat("Best quantity", formatAmount(optimum)),
      ],
      warnings:
        requested > 0 && Math.abs(requested - optimum) / optimum > 0.5
          ? ["Far from the best quantity; net power falls off steeply."]
          : undefined,
    };
  },
};

export const endgameSources: PowerSourceDefinition[] = [
  lnr,
  buildFusion(false),
  buildFusion(true),
  eoh,
  antimatter,
];
