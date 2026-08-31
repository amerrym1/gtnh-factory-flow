/**
 * The steam producers: the four Large Boilers and the heat exchanger family.
 * Boiler rule from the workbook: burning a liquid AND a solid at once gives
 * 100% steam and halves each fuel's burn rate; either alone gives 80%.
 * Exchangers convert hot fluids to steam by threshold: below it the Under
 * ratio and lower grade, at/above it the Over ratio and higher grade.
 */
import { findFuel, powerPlannerData, type PowerFuelEntry } from "../planner-data";
import type { PowerModel, PowerSourceDefinition, PowerSetting } from "../types";
import { formatAmount, items, liters, stat } from "./helpers";

interface BoilerSpec {
  id: string;
  name: string;
  unlock: string;
  steamPerTick: number;
  singleFuelSteamPerTick: number;
  steamGrade: "Steam" | "SH Steam";
  liquidTable: PowerFuelEntry[];
  solidTable: PowerFuelEntry[];
}

const BOILER_SPECS: BoilerSpec[] = [
  {
    id: "large-bronze-boiler",
    name: "Large Bronze Boiler",
    unlock: "LV",
    steamPerTick: 1200,
    singleFuelSteamPerTick: 960,
    steamGrade: "Steam",
    liquidTable: powerPlannerData.boilerFuels.bronzeLiquid,
    solidTable: powerPlannerData.boilerFuels.bronzeSolid,
  },
  {
    id: "large-steel-boiler",
    name: "Large Steel Boiler",
    unlock: "MV",
    steamPerTick: 3000,
    singleFuelSteamPerTick: 2400,
    steamGrade: "Steam",
    liquidTable: powerPlannerData.boilerFuels.steelLiquid,
    solidTable: powerPlannerData.boilerFuels.steelSolid,
  },
  {
    id: "large-titanium-boiler",
    name: "Large Titanium Boiler",
    unlock: "HV",
    steamPerTick: 4000,
    singleFuelSteamPerTick: 3200,
    steamGrade: "SH Steam",
    liquidTable: powerPlannerData.boilerFuels.titaniumLiquid,
    solidTable: powerPlannerData.boilerFuels.titaniumSolid,
  },
  {
    id: "large-tungstensteel-boiler",
    name: "Large Tungstensteel Boiler",
    unlock: "EV",
    steamPerTick: 16000,
    singleFuelSteamPerTick: 12800,
    steamGrade: "SH Steam",
    liquidTable: powerPlannerData.boilerFuels.tungstensteelLiquid,
    solidTable: powerPlannerData.boilerFuels.tungstensteelSolid,
  },
];

const NO_FUEL = "None";

function fuelChoices(table: PowerFuelEntry[]): Array<{ key: string; label: string }> {
  return [{ key: NO_FUEL, label: "None" }, ...table.map((entry) => ({ key: entry.name, label: entry.name }))];
}

function buildBoiler(spec: BoilerSpec): PowerSourceDefinition {
  return {
    id: spec.id,
    name: spec.name,
    group: "steam",
    unlock: spec.unlock,
    blurb: `${formatAmount(spec.steamPerTick)} L/t of ${
      spec.steamGrade === "SH Steam" ? "SH steam" : "steam"
    } on dual fuel.`,
    settings: [
      {
        type: "select",
        id: "liquidFuel",
        label: "Liquid fuel",
        options: fuelChoices(spec.liquidTable),
        defaultKey: spec.liquidTable[0]?.name ?? NO_FUEL,
      },
      {
        type: "select",
        id: "solidFuel",
        label: "Solid fuel",
        options: fuelChoices(spec.solidTable),
        defaultKey: NO_FUEL,
      },
    ],
    compute(read): PowerModel {
      const liquidName = read.select("liquidFuel");
      const solidName = read.select("solidFuel");
      const liquid = liquidName === NO_FUEL ? undefined : findFuel(spec.liquidTable, liquidName);
      const solid = solidName === NO_FUEL ? undefined : findFuel(spec.solidTable, solidName);
      const dual = Boolean(liquid && solid);
      const steamPerTick = !liquid && !solid ? 0 : dual ? spec.steamPerTick : spec.singleFuelSteamPerTick;

      const inputs: PowerModel["inputs"] = [];
      if (liquid?.burnTime) {
        // 1000 L lasts burnTime seconds; sharing the firebox halves the rate.
        inputs.push(liters(liquid.name, 1000 / (liquid.burnTime * (dual ? 2 : 1))));
      }
      if (solid?.burnTime) {
        inputs.push(items(solid.name, 1 / (solid.burnTime * (dual ? 2 : 1))));
      }
      if (steamPerTick > 0) {
        inputs.push(liters("Water", (steamPerTick / 160) * 20));
      }

      return {
        euPerTick: 0,
        inputs,
        outputs: steamPerTick > 0 ? [liters(spec.steamGrade, steamPerTick * 20)] : [],
        stats: [
          stat("Steam", `${formatAmount(steamPerTick)} L/t`),
          stat("Firebox", dual ? "Dual fuel: 100%" : "Single fuel: 80%"),
        ],
        warnings: !liquid && !solid ? ["Pick a fuel to make steam."] : undefined,
      };
    },
  };
}

/** Exchanger tiers above 1 shift the threshold by the fluid's throttle and cost 1.5% steam each. */
function buildExchanger(entry: (typeof powerPlannerData.heatExchangers)[number]): PowerSourceDefinition {
  const isThermalBoiler = entry.name === "Thermal Boiler";
  const isExtreme = entry.name === "Extreme Heat Exchanger";
  const capAtMax = isThermalBoiler || isExtreme || entry.name === "Whakawhiti Wera XL";
  const fluidNames = Object.keys(entry.fluids);
  const id = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // Names as the resource map keys them (the workbook's own spellings).
  const COLD_RETURN: Record<string, string | undefined> = {
    Lava: "Pahoehoe Lava",
    "Hot Coolant": "Coolant",
    "Hot Solar Salt": "Cold Solar Salt",
  };
  const defaults = entry.fluids[fluidNames[0]];

  const settings: PowerSetting[] = [
    {
      type: "select",
      id: "fluid",
      label: "Hot fluid",
      options: fluidNames.map((name) => ({ key: name, label: name })),
      defaultKey: fluidNames[0],
    },
    {
      type: "number",
      id: "intake",
      label: "Hot fluid rate",
      min: 1,
      max: 10_000_000,
      step: 1,
      defaultValue: Math.max(1, defaults?.threshold ?? 1),
      unit: "L/s",
    },
    { type: "number", id: "tier", label: "Pipe tier", min: 1, max: 10, step: 1, defaultValue: 1 },
  ];

  return {
    id,
    name: entry.name,
    group: "steam",
    unlock: isExtreme ? "UHV" : isThermalBoiler ? "HV" : entry.name.startsWith("Whakawhiti") ? "UV" : "EV",
    blurb: isExtreme
      ? "Hot fluids to supercritical steam."
      : entry.name.startsWith("Whakawhiti")
        ? "32 heat exchangers in one block."
        : "Hot fluids to steam; cold comes back.",
    settings,
    compute(read): PowerModel {
      const fluidName = read.select("fluid");
      const rule = entry.fluids[fluidName] ?? defaults;
      const tier = read.number("tier");
      const intake = read.number("intake");
      const threshold = rule.threshold + (tier - 1) * rule.throttle;
      const cap = capAtMax ? rule.max : threshold * 2;
      const used = Math.min(intake, cap);
      const overThreshold = used >= threshold;
      const ratio = overThreshold ? rule.overRatio : rule.underRatio;
      const efficiency = isThermalBoiler ? 1 : 1 - 0.015 * (tier - 1);
      const steamPerSecond = used * ratio * efficiency;
      const grade = isThermalBoiler
        ? "SH Steam"
        : isExtreme
          ? overThreshold
            ? "SC Steam"
            : "SH Steam"
          : overThreshold
            ? "SH Steam"
            : "Steam";

      const outputs = [liters(grade, steamPerSecond)];
      const coldReturn = COLD_RETURN[fluidName];
      if (coldReturn) {
        outputs.push(liters(coldReturn, used));
      }
      return {
        euPerTick: 0,
        inputs: [liters(fluidName, used), liters("Distilled Water", steamPerSecond / 160)],
        outputs,
        stats: [
          stat("Steam", `${formatAmount(steamPerSecond / 20)} L/t ${grade}`),
          stat("Threshold", `${formatAmount(threshold)} L/s`),
        ],
        warnings:
          intake > cap ? [`Intake is capped at ${formatAmount(cap)} L/s for this fluid.`] : undefined,
      };
    },
  };
}

export const steamMakerSources: PowerSourceDefinition[] = [
  ...BOILER_SPECS.map(buildBoiler),
  ...powerPlannerData.heatExchangers.map(buildExchanger),
];
