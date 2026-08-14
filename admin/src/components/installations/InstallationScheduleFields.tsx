import { Field, Input } from "@chakra-ui/react";
import { DateField } from "../ui/DateField";
import { SelectField } from "../ui/SelectField";

export function defaultInstallationDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const DEFAULT_INSTALLATION_TIME = "09:00";

const CONTROL_H = "40px";

type Props = {
  date: string;
  time: string;
  assignmentMode: "auto" | "manual";
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onAssignmentModeChange: (value: "auto" | "manual") => void;
  disabled?: boolean;
  required?: boolean;
};

export function InstallationScheduleFields({
  date,
  time,
  assignmentMode,
  onDateChange,
  onTimeChange,
  onAssignmentModeChange,
  disabled,
  required = true,
}: Props) {
  return (
    <>
      <Field.Root required={required} w="full" minW={0}>
        <Field.Label>Installation date</Field.Label>
        <DateField
          size="md"
          value={date}
          onChange={onDateChange}
          disabled={disabled}
          min={new Date().toISOString().slice(0, 10)}
        />
      </Field.Root>
      <Field.Root required={required} w="full" minW={0}>
        <Field.Label>Installation time</Field.Label>
        <Input
          type="time"
          w="full"
          h={CONTROL_H}
          minH={CONTROL_H}
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
          disabled={disabled}
        />
      </Field.Root>
      <Field.Root w="full" minW={0} gridColumn={{ md: "span 2" }}>
        <Field.Label>Technician assignment</Field.Label>
        <SelectField
          disabled={disabled}
          fieldProps={{
            value: assignmentMode,
            onChange: (e) =>
              onAssignmentModeChange(e.target.value === "manual" ? "manual" : "auto"),
          }}
        >
          <option value="auto">Auto-assign a technician</option>
          <option value="manual">Assign later</option>
        </SelectField>
      </Field.Root>
    </>
  );
}
