import { useEffect, useState } from "react";
import { Field, Input, Text } from "@chakra-ui/react";
import { api, type InstallationTechnician } from "../../lib/api";
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
  technicianId?: number | null;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onAssignmentModeChange: (value: "auto" | "manual") => void;
  onTechnicianIdChange: (value: number | null) => void;
  disabled?: boolean;
  required?: boolean;
};

function technicianLabel(tech: InstallationTechnician) {
  return tech.jobTitle ? `${tech.name} (${tech.jobTitle})` : tech.name;
}

export function InstallationScheduleFields({
  date,
  time,
  assignmentMode,
  technicianId = null,
  onDateChange,
  onTimeChange,
  onAssignmentModeChange,
  onTechnicianIdChange,
  disabled,
  required = true,
}: Props) {
  const [technicians, setTechnicians] = useState<InstallationTechnician[]>([]);
  const [loadingTechnicians, setLoadingTechnicians] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingTechnicians(true);
    api
      .listInstallationTechnicians()
      .then((res) => {
        if (!cancelled) setTechnicians(res.technicians || []);
      })
      .catch(() => {
        if (!cancelled) setTechnicians([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTechnicians(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectValue =
    technicianId && technicianId > 0 ? String(technicianId) : assignmentMode;

  function applyAssignment(value: string) {
    if (value === "auto") {
      onAssignmentModeChange("auto");
      onTechnicianIdChange(null);
      return;
    }
    if (value === "manual") {
      onAssignmentModeChange("manual");
      onTechnicianIdChange(null);
      return;
    }
    const id = Number(value);
    onAssignmentModeChange("manual");
    onTechnicianIdChange(Number.isFinite(id) && id > 0 ? id : null);
  }

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
          isLoading={loadingTechnicians}
          fieldProps={{
            value: selectValue,
            onChange: (e) => applyAssignment(e.target.value),
          }}
        >
          <option value="auto">Auto-assign a technician</option>
          <option value="manual">Assign later</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={String(tech.id)}>
              {technicianLabel(tech)}
            </option>
          ))}
        </SelectField>
        {!loadingTechnicians && !technicians.length ? (
          <Text fontSize="xs" color="fg.muted" mt={2}>
            No technicians are available yet. Add staff to the Technician group
            in Settings → Users, or pick Assign later.
          </Text>
        ) : null}
      </Field.Root>
    </>
  );
}
