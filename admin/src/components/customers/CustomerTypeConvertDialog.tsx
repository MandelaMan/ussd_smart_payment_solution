import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Field,
  Flex,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { api, type Agency, type Customer } from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import { ModalShell } from "../ui/ModalShell";
import { SearchableSelect } from "../ui/SearchableSelect";
import { toaster } from "../ui/toaster";

type Props = {
  customer: Customer | null;
  onClose: () => void;
  onConverted: (
    customer: Customer,
    meta: {
      previousCustomerNumber: string;
      newCustomerNumber: string;
      tisp?: { ok: boolean; error?: string };
    }
  ) => void;
};

export function CustomerTypeConvertDialog({
  customer,
  onClose,
  onConverted,
}: Props) {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loadingAgencies, setLoadingAgencies] = useState(false);
  const [agencyMode, setAgencyMode] = useState<"select" | "create">("select");
  const [agencyId, setAgencyId] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [agencyEmail, setAgencyEmail] = useState("");
  const [agencyPhone, setAgencyPhone] = useState("");
  const [agencyContact, setAgencyContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const targetType = customer?.customerType === "C2B" ? "B2B" : "C2B";
  const toB2B = targetType === "B2B";

  useEffect(() => {
    if (!customer) return;
    setAgencyMode("select");
    setAgencyId(customer.agencyId ? String(customer.agencyId) : "");
    setAgencyName("");
    setAgencyEmail("");
    setAgencyPhone("");
    setAgencyContact("");
    setConfirmStep(false);
    setLoadingAgencies(true);
    api
      .listAgencies({ limit: "200" })
      .then((res) => setAgencies(res.agencies))
      .catch(() => {
        toaster.create({
          title: "Failed to load agencies",
          type: "error",
        });
      })
      .finally(() => setLoadingAgencies(false));
  }, [customer]);

  const agencyOptions = useMemo(
    () =>
      agencies.map((a) => ({
        value: String(a.id),
        label: a.name,
        description: [a.contactPerson, a.email, a.phone].filter(Boolean).join(" · ") || undefined,
      })),
    [agencies]
  );

  if (!customer) return null;

  const activeCustomer = customer;

  const canContinueToB2B =
    agencyMode === "select"
      ? Boolean(agencyId)
      : Boolean(agencyName.trim() && agencyEmail.trim() && agencyPhone.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!confirmStep) {
      if (toB2B && !canContinueToB2B) return;
      setConfirmStep(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.convertCustomerType(activeCustomer.id, {
        customerType: targetType,
        agencyId: toB2B && agencyMode === "select" ? Number(agencyId) : undefined,
        newAgency:
          toB2B && agencyMode === "create"
            ? {
                name: agencyName.trim(),
                email: agencyEmail.trim(),
                phone: agencyPhone.trim(),
                contactPerson: agencyContact.trim() || undefined,
              }
            : undefined,
      });
      onConverted(res.customer, {
        previousCustomerNumber: res.previousCustomerNumber,
        newCustomerNumber: res.newCustomerNumber,
        tisp: res.tisp,
      });
    } catch (err) {
      toaster.create({
        title: "Conversion failed",
        description: err instanceof Error ? err.message : "Please try again",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell open onClose={onClose} maxW="32rem">
      <Box px={5} pt={5} pb={4} pr={12} borderBottomWidth="1px" borderColor="border.muted">
        <Text fontSize="lg" fontWeight="semibold" color="fg">
          Convert to {targetType}
        </Text>
        <Text fontSize="xs" color="fg.muted" mt={0.5}>
          {formatTitleCase(customer.fullName)} · {customer.customerNumber}
        </Text>
      </Box>

      <Box as="form" px={5} py={5} onSubmit={(e) => void handleSubmit(e)}>
        <Stack gap={4}>
          {!confirmStep ? (
            <>
              <Box bg="brand.50" borderRadius="md" px={3} py={3} fontSize="sm" color="brand.900">
                {toB2B ? (
                  <>
                    This customer will be billed as <strong>B2B</strong>. Their customer
                    number will switch to the building&apos;s B2B code and invoices will be
                    sent to the selected agency.
                  </>
                ) : (
                  <>
                    This customer will be billed as <strong>C2B</strong>. The agency link
                    will be removed and their customer number will switch to the building&apos;s
                    C2B code.
                  </>
                )}
              </Box>

              {toB2B ? (
                <Stack gap={3}>
                  <Flex gap={2} wrap="wrap">
                    <Button
                      size="sm"
                      variant={agencyMode === "select" ? "solid" : "outline"}
                      colorPalette="brand"
                      bg={agencyMode === "select" ? undefined : "white"}
                      onClick={() => setAgencyMode("select")}
                    >
                      Select agency
                    </Button>
                    <Button
                      size="sm"
                      variant={agencyMode === "create" ? "solid" : "outline"}
                      colorPalette="brand"
                      bg={agencyMode === "create" ? undefined : "white"}
                      onClick={() => setAgencyMode("create")}
                    >
                      Create agency
                    </Button>
                  </Flex>

                  {agencyMode === "select" ? (
                    <Field.Root required>
                      <Field.Label>Agency</Field.Label>
                      <SearchableSelect
                        value={agencyId}
                        onChange={setAgencyId}
                        options={agencyOptions}
                        placeholder={loadingAgencies ? "Loading agencies…" : "Select agency"}
                        searchPlaceholder="Search agencies…"
                        emptyLabel="No agencies found"
                        disabled={loadingAgencies}
                      />
                      <Field.HelperText>
                        B2B customers must be linked to an agency for invoicing.
                      </Field.HelperText>
                    </Field.Root>
                  ) : (
                    <Stack gap={3}>
                      <Field.Root required>
                        <Field.Label>Agency name</Field.Label>
                        <Input
                          value={agencyName}
                          onChange={(e) => setAgencyName(e.target.value)}
                        />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>Contact person</Field.Label>
                        <Input
                          value={agencyContact}
                          onChange={(e) => setAgencyContact(e.target.value)}
                        />
                      </Field.Root>
                      <Field.Root required>
                        <Field.Label>Email</Field.Label>
                        <Input
                          type="email"
                          value={agencyEmail}
                          onChange={(e) => setAgencyEmail(e.target.value)}
                        />
                      </Field.Root>
                      <Field.Root required>
                        <Field.Label>Phone</Field.Label>
                        <Input
                          value={agencyPhone}
                          onChange={(e) => setAgencyPhone(e.target.value)}
                        />
                      </Field.Root>
                    </Stack>
                  )}
                </Stack>
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  Current agency:{" "}
                  <strong>{customer.agencyName ? formatTitleCase(customer.agencyName) : "—"}</strong>
                </Text>
              )}
            </>
          ) : (
            <Box bg="orange.50" borderRadius="md" px={3} py={3} fontSize="sm" color="orange.900">
              Confirm conversion of <strong>{formatTitleCase(customer.fullName)}</strong> from{" "}
              <strong>{customer.customerType}</strong> to <strong>{targetType}</strong>?
              {toB2B && agencyMode === "select" && agencyId ? (
                <>
                  {" "}
                  Agency:{" "}
                  <strong>
                    {formatTitleCase(
                      agencies.find((a) => String(a.id) === agencyId)?.name || ""
                    )}
                  </strong>
                </>
              ) : null}
              {toB2B && agencyMode === "create" ? (
                <>
                  {" "}
                  New agency: <strong>{formatTitleCase(agencyName)}</strong>
                </>
              ) : null}
              {!toB2B ? " The agency link will be removed." : null}{" "}
              The customer number will change on TISP from{" "}
              <strong>{customer.customerNumber}</strong> to the building&apos;s{" "}
              {targetType} code (same apartment).
            </Box>
          )}

          <Flex justify="flex-end" gap={2}>
            {confirmStep ? (
              <Button variant="ghost" onClick={() => setConfirmStep(false)}>
                Go back
              </Button>
            ) : (
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              colorPalette={confirmStep ? "brand" : "brand"}
              loading={submitting}
              disabled={!confirmStep && toB2B && !canContinueToB2B}
            >
              {confirmStep ? `Yes, convert to ${targetType}` : "Continue"}
            </Button>
          </Flex>
        </Stack>
      </Box>
    </ModalShell>
  );
}
