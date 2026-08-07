import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiArrowLeft, FiClock, FiHome } from "react-icons/fi";
import { api, type ApartmentUnit } from "../lib/api";
import { PAGE_STACK_GAP, PageErrorBanner } from "../components/ui/pageLayout";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ApartmentDetailSkeleton } from "../components/PageSkeletons";
import { BRAND } from "../theme";

type ApartmentDetailContextValue = {
  apartment: ApartmentUnit;
  reload: () => Promise<void>;
};

const ApartmentDetailContext = createContext<ApartmentDetailContextValue | null>(
  null
);

export function useApartmentDetail() {
  const ctx = useContext(ApartmentDetailContext);
  if (!ctx) {
    throw new Error("useApartmentDetail must be used within ApartmentDetailLayout");
  }
  return ctx;
}

function apartmentBasePath(buildingId: string, apartmentNumber: string) {
  return `/apartments/${buildingId}/${encodeURIComponent(apartmentNumber)}`;
}

export function ApartmentDetailLayout() {
  const navigate = useNavigate();
  const { buildingId = "", apartmentNumber = "" } = useParams();
  const decodedApt = decodeURIComponent(apartmentNumber);
  const [apartment, setApartment] = useState<ApartmentUnit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const res = await api.getApartment(Number(buildingId), decodedApt);
    setApartment(res.apartment);
  }, [buildingId, decodedApt]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .getApartment(Number(buildingId), decodedApt)
      .then((res) => {
        if (!cancelled) setApartment(res.apartment);
      })
      .catch((err) => {
        if (!cancelled) {
          setApartment(null);
          setError(
            err instanceof Error ? err.message : "Failed to load apartment"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId, decodedApt]);

  const base = apartmentBasePath(buildingId, decodedApt);
  const value = useMemo(
    () => (apartment ? { apartment, reload } : null),
    [apartment, reload]
  );

  const tabs = [
    { to: base, end: true, label: "Overview", icon: FiHome },
    { to: `${base}/history`, end: false, label: "History", icon: FiClock },
  ];

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <MobilePageChrome
        title={decodedApt || "Apartment"}
        description={
          apartment
            ? `${apartment.buildingName} · ${apartment.occupied ? "Occupied" : "Vacant"}`
            : "Unit details"
        }
        headerActions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate("/apartments")}
            aria-label="Back to apartments"
          >
            <FiArrowLeft />
          </Button>
        }
      />

      <Flex
        display={{ base: "none", lg: "flex" }}
        align="center"
        justify="space-between"
        gap={3}
        flexWrap="wrap"
      >
        <Box minW={0}>
          <Button
            size="sm"
            variant="ghost"
            mb={1}
            onClick={() => navigate("/apartments")}
          >
            <FiArrowLeft /> Back to apartments
          </Button>
          <Heading size="lg">{decodedApt}</Heading>
          {apartment ? (
            <Text fontSize="sm" color="fg.muted" mt={0.5}>
              {apartment.buildingName}
              {" · "}
              <Badge
                as="span"
                colorPalette={apartment.occupied ? "green" : "gray"}
                variant="subtle"
                verticalAlign="middle"
              >
                {apartment.occupied ? "Occupied" : "Vacant"}
              </Badge>
            </Text>
          ) : null}
        </Box>
      </Flex>

      <Flex
        gap={1}
        borderBottomWidth="1px"
        borderColor="border.muted"
        overflowX="auto"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            style={{ textDecoration: "none" }}
          >
            {({ isActive }) => (
              <Flex
                align="center"
                gap={2}
                px={3}
                py={2.5}
                fontSize="sm"
                fontWeight="medium"
                color={isActive ? BRAND.cerulean : "fg.muted"}
                borderBottomWidth="2px"
                borderBottomColor={isActive ? BRAND.cerulean : "transparent"}
                whiteSpace="nowrap"
              >
                <tab.icon size={15} />
                {tab.label}
              </Flex>
            )}
          </NavLink>
        ))}
      </Flex>

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {loading ? (
        <ApartmentDetailSkeleton />
      ) : value ? (
        <ApartmentDetailContext.Provider value={value}>
          <Outlet />
        </ApartmentDetailContext.Provider>
      ) : null}
    </Stack>
  );
}
