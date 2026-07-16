import { Button } from "@chakra-ui/react";
import { FiEdit2, FiHome } from "react-icons/fi";
import { formatDate, type Building } from "../../lib/api";
import { ipRulesHint } from "../../lib/buildingIpRules";
import { formatTitleCase } from "../../lib/formatText";
import {
  DetailCard,
  DetailGrid,
  EntityExpandShell,
  StatusPill,
} from "../module/EntityExpandShell";

type Props = {
  building: Building;
  onEdit: (building: Building) => void;
  canEdit?: boolean;
};

export function BuildingExpandPanel({ building, onEdit, canEdit = true }: Props) {
  return (
    <EntityExpandShell
      icon={FiHome}
      title={formatTitleCase(building.name)}
      subtitle={`${building.c2bCode} / ${building.b2bCode}`}
      badge={
        <StatusPill
          label={building.ipSetup}
          colorPalette={building.ipSetup === "STATIC" ? "blue" : "purple"}
        />
      }
      actions={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => onEdit(building)}>
            <FiEdit2 />
            Edit
          </Button>
        ) : undefined
      }
      accent="brand.600"
    >
      <DetailGrid>
        <DetailCard label="C2B code" value={building.c2bCode} mono highlight />
        <DetailCard label="B2B code" value={building.b2bCode} mono />
        <DetailCard label="IP setup" value={building.ipSetup} />
        <DetailCard
          label="DSTV setup"
          value={building.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder"}
        />
        <DetailCard
          label="IP prefixes"
          value={
            building.ipSetup === "PPOE"
              ? "Not applicable (PPOE)"
              : building.ipPrefixes?.length
                ? ipRulesHint(building)
                : "None configured"
          }
        />
        <DetailCard
          label="Added"
          value={building.createdAt ? formatDate(building.createdAt) : null}
        />
      </DetailGrid>
    </EntityExpandShell>
  );
}
