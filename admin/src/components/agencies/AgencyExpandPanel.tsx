import { Link } from "react-router-dom";
import { Button } from "@chakra-ui/react";
import { FiBriefcase, FiEdit2 } from "react-icons/fi";
import { formatDate, type Agency } from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import {
  DetailCard,
  DetailGrid,
  EntityExpandShell,
} from "../module/EntityExpandShell";

type Props = {
  agency: Agency;
  onEdit: (agency: Agency) => void;
  canEdit?: boolean;
};

export function AgencyExpandPanel({ agency, onEdit, canEdit = true }: Props) {
  return (
    <EntityExpandShell
      icon={FiBriefcase}
      title={formatTitleCase(agency.name)}
      subtitle={agency.email}
      value={
        <Button asChild size="sm" variant="outline">
          <Link to={`/agencies/${agency.id}`}>View customers</Link>
        </Button>
      }
      actions={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => onEdit(agency)}>
            <FiEdit2 />
            Edit
          </Button>
        ) : undefined
      }
      accent="blue.600"
    >
      <DetailGrid>
        <DetailCard label="Contact person" value={formatTitleCase(agency.contactPerson)} highlight />
        <DetailCard label="Email" value={agency.email} />
        <DetailCard label="Phone" value={agency.phone} />
        <DetailCard label="Active customers" value={String(agency.activeCustomers ?? 0)} />
        <DetailCard
          label="Discount"
          value={
            agency.discountPercent != null && agency.discountPercent > 0
              ? `${agency.discountPercent}%`
              : "None"
          }
        />
        <DetailCard
          label="Added"
          value={agency.createdAt ? formatDate(agency.createdAt) : null}
        />
      </DetailGrid>
    </EntityExpandShell>
  );
}
