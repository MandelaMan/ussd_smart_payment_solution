const AMBER = { r: 249, g: 164, b: 86 }; // brand sandy brown
const GREEN = { r: 22, g: 163, b: 74 };

export type PasswordStrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

export type PasswordStrength = {
  level: PasswordStrengthLevel;
  score: number;
  percent: number;
  label: string;
  color: string;
  meetsPolicy: boolean;
};

function mixRgb(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number
) {
  const clamped = Math.min(1, Math.max(0, t));
  const r = Math.round(from.r + (to.r - from.r) * clamped);
  const g = Math.round(from.g + (to.g - from.g) * clamped);
  const b = Math.round(from.b + (to.b - from.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

export function meetsPasswordPolicy(password: string) {
  const value = String(password || "");
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /[a-z]/i.test(value) &&
    /\d/.test(value)
  );
}

export function scorePassword(password: string): PasswordStrength {
  const value = String(password || "");
  if (!value) {
    return {
      level: "empty",
      score: 0,
      percent: 0,
      label: "",
      color: "var(--chakra-colors-gray-300)",
      meetsPolicy: false,
    };
  }

  const hasLetter = /[a-z]/i.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);
  const longEnough = value.length >= 8;
  const extraLong = value.length >= 12;
  const mixedCase = hasLower && hasUpper;
  const meetsPolicy = longEnough && hasLetter && hasNumber && value.length <= 128;

  let extras = 0;
  if (mixedCase) extras += 1;
  if (hasSpecial) extras += 1;
  if (extraLong) extras += 1;

  let level: PasswordStrengthLevel = "weak";
  if (meetsPolicy) {
    if (extras >= 2) level = "strong";
    else if (extras >= 1) level = "good";
    else level = "fair";
  }

  const score =
    level === "weak" ? 1 : level === "fair" ? 2 : level === "good" ? 3 : 4;
  const percent = (score / 4) * 100;
  const color = mixRgb(AMBER, GREEN, (score - 1) / 3);
  const label =
    level === "weak"
      ? "Weak"
      : level === "fair"
        ? "Fair"
        : level === "good"
          ? "Good"
          : "Strong";

  return { level, score, percent, label, color, meetsPolicy };
}
