import { Link as RouterLink } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Grid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiClock } from "react-icons/fi";
import { formatDate } from "../lib/api";
import { useApartmentDetail } from "./ApartmentDetailLayout";

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" mb={0.5} textTransform="uppercase" letterSpacing="0.04em">
        {label}
      </Text>
      <Box fontSize="sm" fontWeight="medium">
        {value}
      </Box>
    </Box>
  );
}

export function ApartmentOverviewPage() {
  const { apartment } = useApartmentDetail();
  const historyPath = `/apartments/${apartment.buildingId}/${encodeURIComponent(apartment.apartmentNumber)}/history`;

  return (
    <Stack gap={4}>
      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        p={4}
      >
        <Text fontSize="sm" fontWeight="semibold" mb={3}>
          Unit details
        </Text>
        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
          gap={4}
        >
          <DetailItem label="Apartment" value={apartment.apartmentNumber} />
          <DetailItem label="Building" value={apartment.buildingName} />
          <DetailItem
            label="Occupancy"
            value={
              <Badge
                colorPalette={apartment.occupied ? "green" : "gray"}
                variant="subtle"
              >
                {apartment.occupied ? "Occupied" : "Vacant"}
              </Badge>
            }
          />
          <DetailItem label="Network setup" value={apartment.ipSetup || "—"} />
          <DetailItem
            label="Current IP"
            value={
              <Text as="span" fontFamily="mono">
                {apartment.currentIp || "—"}
              </Text>
            }
          />
          <DetailItem
            label="Last known IP"
            value={
              <Text as="span" fontFamily="mono">
                {apartment.lastKnownIp || "—"}
              </Text>
            }
          />
          <DetailItem label="C2B code" value={apartment.c2bCode || "—"} />
          <DetailItem label="B2B code" value={apartment.b2bCode || "—"} />
          <DetailItem
            label="DSTV setup"
            value={
              apartment.dstvSetup === "headend_coax"
                ? "Headend coax"
                : apartment.dstvSetup === "decoder"
                  ? "Decoder"
                  : apartment.dstvSetup || "—"
            }
          />
          <DetailItem
            label="Tenure count"
            value={String(apartment.tenureCount)}
          />
          <DetailItem
            label="First occupied"
            value={
              apartment.firstOccupiedAt
                ? formatDate(apartment.firstOccupiedAt)
                : "—"
            }
          />
          <DetailItem
            label="Occupied since"
            value={
              apartment.occupiedSince
                ? formatDate(apartment.occupiedSince)
                : "—"
            }
          />
          <DetailItem
            label="Last activity"
            value={
              apartment.lastActivityAt
                ? formatDate(apartment.lastActivityAt)
                : "—"
            }
          />
          <DetailItem
            label="Active account #"
            value={
              apartment.currentCustomerNumber ? (
                <Button
                  asChild
                  variant="plain"
                  size="sm"
                  h="auto"
                  minH={0}
                  p={0}
                  color="brand.600"
                >
                  <RouterLink
                    to={`/customers?search=${encodeURIComponent(apartment.currentCustomerNumber)}`}
                  >
                    {apartment.currentCustomerNumber}
                  </RouterLink>
                </Button>
              ) : (
                "—"
              )
            }
          />
        </Grid>
      </Box>

      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        p={4}
      >
        <Button asChild size="sm" colorPalette="brand">
          <RouterLink to={historyPath}>
            <FiClock /> Open history
          </RouterLink>
        </Button>
      </Box>
    </Stack>
  );
}
