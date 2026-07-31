export function computePartCostCents({ grams, print_hours, cost_per_kg_cents, machine_hourly_rate_cents }) {
  const filament = Math.round((grams / 1000) * cost_per_kg_cents);
  const machine = Math.round(print_hours * machine_hourly_rate_cents);
  return filament + machine;
}

export function computePrintUnitCostCents({ parts, filamentRatesById, machine_hourly_rate_cents, extras_cost_cents }) {
  const partsTotal = parts.reduce((sum, part) => {
    const rate = filamentRatesById[part.filament_id];
    const cost_per_kg_cents = rate ? rate.cost_per_kg_cents : 0;
    return sum + computePartCostCents({
      grams: part.grams,
      print_hours: part.print_hours,
      cost_per_kg_cents,
      machine_hourly_rate_cents,
    });
  }, 0);
  return partsTotal + (extras_cost_cents || 0);
}
