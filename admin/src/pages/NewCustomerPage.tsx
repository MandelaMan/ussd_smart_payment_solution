import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Text } from "@chakra-ui/react";
import { CustomerForm } from "../components/customers/CustomerForm";
import { api } from "../lib/api";
import { parseLeadSignup, type LeadSignupPrefill } from "../lib/leadSignup";
import { toaster } from "../components/ui/toaster";

export function NewCustomerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const leadIdRaw = Number(searchParams.get("leadId") || 0);
  const leadId = Number.isFinite(leadIdRaw) && leadIdRaw > 0 ? leadIdRaw : null;
  const [leadPrefill, setLeadPrefill] = useState<LeadSignupPrefill | null>(null);
  const [leadLoading, setLeadLoading] = useState(Boolean(leadId));

  useEffect(() => {
    if (!leadId) {
      setLeadPrefill(null);
      setLeadLoading(false);
      return;
    }
    let cancelled = false;
    setLeadLoading(true);
    api
      .getLead(leadId)
      .then(({ lead }) => {
        if (cancelled) return;
        const parsed = parseLeadSignup(lead);
        if (parsed.status === "converted" && parsed.convertedCustomerId) {
          toaster.create({
            type: "info",
            title: "This signup is already converted",
            description: `Customer #${parsed.convertedCustomerId} already exists for this lead.`,
          });
        }
        setLeadPrefill(parsed);
      })
      .catch((e) => {
        if (cancelled) return;
        toaster.create({
          type: "error",
          title: e instanceof Error ? e.message : "Failed to load signup",
        });
        setLeadPrefill(null);
      })
      .finally(() => {
        if (!cancelled) setLeadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (leadLoading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading signup details…
      </Text>
    );
  }

  return (
    <CustomerForm
      leadPrefill={leadPrefill}
      onCreated={() => {
        navigate("/customers");
      }}
    />
  );
}
