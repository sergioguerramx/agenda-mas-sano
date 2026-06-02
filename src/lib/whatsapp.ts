export function normalizeMexicanWhatsapp(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("52") ? digits.slice(2) : digits;
  return local.length === 10 ? `+52${local}` : null;
}
