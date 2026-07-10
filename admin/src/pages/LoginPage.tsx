import { type FormEvent, useState } from "react";
import {
  Box,
  Button,
  Field,
  Flex,
  Heading,
  Image,
  Input,
  InputGroup,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Navigate } from "react-router-dom";
import { FiActivity, FiLock, FiMail, FiRepeat, FiTrendingUp, FiUsers, FiZap } from "react-icons/fi";
import { useAuth } from "../lib/auth";
import { BRAND } from "../theme";

type StatBadgeConfig = {
  key: string;
  label: string;
  value: string;
  icon: React.ReactNode;
  bg: string;
  iconBg: string;
  iconColor: string;
  labelColor: string;
  valueColor: string;
  borderColor: string;
  delay: number;
  top?: string;
  left?: string;
};

/** Decorative figures for the login hero — not live data */
const DEMO_TILE_STATS = {
  transactions: "2,847",
  successRate: "97%",
  returning: "412",
  activeCustomers: "1,856",
  returningPayers: "412",
  integrationsActive: "3",
};

const CHART_BARS = [38, 52, 44, 68, 58, 74, 62, 80, 70, 86, 76, 64];

const OVERVIEW_CARD_PROPS = {
  w: { base: "full", md: "88%" } as const,
  maxW: { md: "340px" } as const,
  borderRadius: "2xl" as const,
  px: { base: 4, md: 5 } as const,
  py: { base: 4, md: 5 } as const,
  mb: { base: 3, md: 0 } as const,
  boxShadow: "0 20px 48px rgba(0,0,0,0.18)",
  minH: { base: "auto", md: "232px" } as const,
};

function LoginOverviewCard({
  top,
  left,
  zIndex = 1,
  bg,
  borderColor,
  backdropFilter,
  animationName,
  animationDelay = "0.2s",
  centerOnMd = false,
  children,
}: {
  top?: Record<string, string> | string;
  left?: Record<string, string> | string;
  zIndex?: number;
  bg: string;
  borderColor: string;
  backdropFilter?: string;
  animationName: string;
  animationDelay?: string;
  centerOnMd?: boolean;
  children: React.ReactNode;
}) {
  const mdRest = centerOnMd ? "translateX(-50%) translateY(0)" : "translateY(0)";
  const mdMid = centerOnMd ? "translateX(-50%) translateY(-10px)" : "translateY(-10px)";

  return (
    <Box
      position={{ base: "relative", md: "absolute" }}
      top={top}
      left={left}
      zIndex={zIndex}
      bg={bg}
      backdropFilter={backdropFilter}
      border="1px solid"
      borderColor={borderColor}
      css={{
        animation: {
          base: `${animationName}-base 3.8s cubic-bezier(0.34, 1.25, 0.64, 1) infinite`,
          md: `${animationName}-md 3.8s cubic-bezier(0.34, 1.25, 0.64, 1) infinite`,
        },
        animationDelay,
        [`@keyframes ${animationName}-base`]: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        [`@keyframes ${animationName}-md`]: {
          "0%, 100%": { transform: mdRest },
          "50%": { transform: mdMid },
        },
      }}
      {...OVERVIEW_CARD_PROPS}
    >
      {children}
    </Box>
  );
}

function ChartSimulation() {
  return (
    <LoginOverviewCard
      top={{ md: "18%" }}
      left={{ md: "50%" }}
      bg="rgba(255,255,255,0.14)"
      backdropFilter="blur(14px)"
      borderColor="whiteAlpha.350"
      animationName="login-chart-float"
      animationDelay="0.2s"
      centerOnMd
    >
      <Flex justify="space-between" align="center" mb={3}>
        <Text fontSize="sm" fontWeight="semibold" color="white">
          Activity Overview
        </Text>
        <Text fontSize="xs" color="whiteAlpha.800">
          Live overview
        </Text>
      </Flex>
      <Flex align="flex-end" gap={1.5} h={{ base: "72px", md: "84px" }} mb={3}>
        {CHART_BARS.map((h, i) => (
          <Box
            key={i}
            flex={1}
            h={`${h}%`}
            borderRadius="sm"
            bg={
              i % 3 === 0
                ? BRAND.paleAzure
                : i % 3 === 1
                  ? BRAND.mindaro
                  : BRAND.sandyBrown
            }
            opacity={0.92}
          />
        ))}
      </Flex>
      <Box position="relative" h="36px">
        <svg viewBox="0 0 320 36" width="100%" height="100%" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke={BRAND.paleAzure}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points="0,28 32,24 64,26 96,18 128,20 160,12 192,14 224,8 256,10 288,6 320,4"
          />
        </svg>
      </Box>
      <Flex justify="space-between" mt={2} fontSize="2xs" color="whiteAlpha.750">
        <Text>Jan</Text>
        <Text>Apr</Text>
        <Text>Jul</Text>
        <Text>Oct</Text>
        <Text>Dec</Text>
      </Flex>
    </LoginOverviewCard>
  );
}

const CUSTOMER_BARS = [72, 58, 84, 66, 78, 62, 88, 70, 76, 64, 82, 68];

function CustomerOverviewCard() {
  const barHeights = CUSTOMER_BARS.map((h, i) =>
    Math.max(18, Math.round((h / 100) * (52 + (i % 4) * 8)))
  );

  return (
    <LoginOverviewCard
      top={{ md: "44%" }}
      left={{ md: "0" }}
      zIndex={2}
      bg="#d8eef6"
      borderColor="rgba(255,255,255,0.6)"
      animationName="login-customer-float"
      animationDelay="0.75s"
    >
      <Flex justify="space-between" align="center" mb={3}>
        <Flex align="center" gap={2}>
          <Flex
            boxSize="32px"
            borderRadius="lg"
            bg="rgba(255,255,255,0.55)"
            color={BRAND.cerulean}
            align="center"
            justify="center"
          >
            <FiUsers size={18} />
          </Flex>
          <Text fontSize="sm" fontWeight="semibold" color="#12596d">
            Customer Base
          </Text>
        </Flex>
        <Text fontSize="xs" color="#12596d" opacity={0.8}>
          Active subscribers
        </Text>
      </Flex>
      <Flex align="flex-end" gap={1.5} h={{ base: "72px", md: "84px" }} mb={3}>
        {barHeights.map((h, i) => (
          <Box
            key={i}
            flex={1}
            h={`${h}%`}
            borderRadius="sm"
            bg={i % 2 === 0 ? BRAND.cerulean : "#3ba8c4"}
            opacity={0.88}
          />
        ))}
      </Flex>
      <Flex align="center" justify="space-between" h="36px">
        <Text fontSize={{ base: "3xl", md: "4xl" }} fontWeight="bold" color={BRAND.cerulean} lineHeight="1">
          {DEMO_TILE_STATS.activeCustomers}
        </Text>
        <Text fontSize="xs" color="#12596d" opacity={0.75} textAlign="right" maxW="120px" lineHeight="1.4">
          {DEMO_TILE_STATS.returningPayers} returning payers
        </Text>
      </Flex>
      <Flex justify="space-between" mt={2} fontSize="2xs" color="#12596d" opacity={0.7}>
        <Text>Managed</Text>
        <Text>Subscribed</Text>
        <Text>Active</Text>
        <Text>Renewing</Text>
        <Text>Live</Text>
      </Flex>
    </LoginOverviewCard>
  );
}

function FloatingStatBadge({
  label,
  value,
  icon,
  bg,
  iconBg,
  iconColor,
  labelColor,
  valueColor,
  borderColor,
  delay,
  top,
  left,
}: Omit<StatBadgeConfig, "key">) {
  return (
    <Box
      position={{ base: "relative", md: "absolute" }}
      top={top}
      left={left}
      zIndex={3}
      bg={bg}
      borderRadius="2xl"
      px={{ base: 4, md: 4 }}
      py={{ base: 3.5, md: 4 }}
      boxShadow="0 14px 36px rgba(0,0,0,0.2)"
      border="2px solid"
      borderColor={borderColor}
      w={{ base: "full", md: "auto" }}
      minW={{ md: "168px", lg: "178px" }}
      css={{
        animation: `login-badge-bounce 3.2s cubic-bezier(0.34, 1.4, 0.64, 1) infinite`,
        animationDelay: `${delay}s`,
        willChange: "transform",
        "@keyframes login-badge-bounce": {
          "0%, 100%": { transform: "translateY(0) scale(1)" },
          "35%": { transform: "translateY(-14px) scale(1.02)" },
          "55%": { transform: "translateY(-5px) scale(1.01)" },
          "70%": { transform: "translateY(-10px) scale(1.015)" },
        },
      }}
    >
      <Flex align="center" gap={2.5} mb={1.5}>
        <Flex
          boxSize={{ base: "36px", md: "40px" }}
          borderRadius="xl"
          bg={iconBg}
          color={iconColor}
          align="center"
          justify="center"
          flexShrink={0}
        >
          {icon}
        </Flex>
        <Text fontSize="xs" color={labelColor} fontWeight="semibold" lineHeight="1.35">
          {label}
        </Text>
      </Flex>
      <Text
        fontSize={{ base: "xl", md: "2xl" }}
        fontWeight="bold"
        color={valueColor}
        lineHeight="1.15"
        letterSpacing="-0.02em"
      >
        {value}
      </Text>
    </Box>
  );
}

const LOGIN_BADGES: StatBadgeConfig[] = [
  {
    key: "transactions",
    label: "Transactions",
    value: DEMO_TILE_STATS.transactions,
    icon: <FiActivity size={20} />,
    bg: BRAND.paleAzure,
    iconBg: "rgba(255,255,255,0.45)",
    iconColor: BRAND.cerulean,
    labelColor: "#0e4858",
    valueColor: BRAND.cerulean,
    borderColor: "rgba(255,255,255,0.55)",
    delay: 0,
    top: "8%",
    left: "14%",
  },
  {
    key: "success",
    label: "Success Rate",
    value: DEMO_TILE_STATS.successRate,
    icon: <FiTrendingUp size={20} />,
    bg: BRAND.mindaro,
    iconBg: "rgba(255,255,255,0.4)",
    iconColor: "#3d5c12",
    labelColor: "#4a5f18",
    valueColor: "#2d4a0f",
    borderColor: "rgba(255,255,255,0.5)",
    delay: 0.5,
    top: "8%",
    left: "54%",
  },
  {
    key: "returning",
    label: "Returning",
    value: DEMO_TILE_STATS.returning,
    icon: <FiRepeat size={20} />,
    bg: BRAND.sandyBrown,
    iconBg: "rgba(255,255,255,0.4)",
    iconColor: "#9a4e12",
    labelColor: "#7a3f10",
    valueColor: "#5c2f0a",
    borderColor: "rgba(255,255,255,0.5)",
    delay: 1,
    top: "54%",
    left: "68%",
  },
];

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Flex minH="100dvh" direction={{ base: "column", md: "row" }}>
      <Flex
        flex={{ base: "0 0 auto", md: "1" }}
        direction="column"
        justify="space-between"
        bg={BRAND.cerulean}
        px={{ base: 5, md: 10, lg: 12 }}
        py={{ base: 7, md: 10, lg: 12 }}
        minH={{ base: "auto", md: "100dvh" }}
        position="relative"
        overflow="hidden"
      >
        <Box
          position="absolute"
          inset={0}
          opacity={0.1}
          backgroundImage="linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)"
          backgroundSize="36px 36px"
        />
        <Box
          position="absolute"
          top="-20%"
          right="-10%"
          w="320px"
          h="320px"
          borderRadius="full"
          bg={BRAND.paleAzure}
          opacity={0.15}
        />
        <Box
          position="absolute"
          bottom="-15%"
          left="-5%"
          w="260px"
          h="260px"
          borderRadius="full"
          bg={BRAND.mindaro}
          opacity={0.12}
        />

        <Flex align="center" gap={3} zIndex={1}>
          <Image
            src="/admin/logo.png"
            alt="SUL"
            boxSize={{ base: "40px", md: "48px" }}
            borderRadius="lg"
            bg="white"
            p={1}
          />
          <Box>
            <Text fontWeight="bold" color="white" fontSize={{ base: "md", md: "lg" }}>
              SUL Solutions
            </Text>
            <Text fontSize="sm" color="whiteAlpha.800">
              Customer & payment operations
            </Text>
          </Box>
        </Flex>

        <Box
          position="relative"
          flex={{ base: "0 0 auto", md: "1" }}
          w="full"
          maxW={{ md: "520px" }}
          mx={{ md: "auto" }}
          minH={{ base: "auto", md: "420px" }}
          my={{ base: 5, md: 6 }}
          zIndex={1}
        >
          <ChartSimulation />
          <CustomerOverviewCard />

          <Stack display={{ base: "flex", md: "none" }} gap={2.5} w="full" mt={3}>
            {LOGIN_BADGES.map(({ key, ...badge }) => (
              <FloatingStatBadge key={key} {...badge} />
            ))}
            <Flex
              align="center"
              justify="center"
              gap={2}
              bg="rgba(255,255,255,0.12)"
              borderRadius="xl"
              px={4}
              py={2.5}
              color="white"
              fontSize="sm"
            >
              <FiZap size={16} />
              <Text fontWeight="medium">{DEMO_TILE_STATS.integrationsActive} integrations active</Text>
            </Flex>
          </Stack>

          <Box display={{ base: "none", md: "block" }} position="relative" h="full" minH="420px">
            {LOGIN_BADGES.map(({ key, ...badge }) => (
              <FloatingStatBadge key={key} {...badge} />
            ))}
          </Box>
        </Box>

        <Box zIndex={1}>
          <Heading
            size="lg"
            color="white"
            lineHeight="1.35"
            maxW="md"
            display={{ base: "none", md: "block" }}
          >
            A unified hub for customer management and billing
          </Heading>
          <Text
            mt={3}
            color="whiteAlpha.800"
            maxW="md"
            fontSize="sm"
            lineHeight="1.6"
            display={{ base: "none", md: "block" }}
          >
            Manage subscribers, packages, and buildings; track M-Pesa collections;
            and keep Zoho and TISP integrations in sync — all in one place.
          </Text>
          <Text
            display={{ base: "block", md: "none" }}
            color="whiteAlpha.900"
            fontSize="sm"
            maxW="xs"
          >
            Sign in to manage customers, subscriptions, payments, and integrations.
          </Text>
        </Box>
      </Flex>

      <Flex
        flex="1"
        align="center"
        justify="center"
        bg="white"
        px={{ base: 6, md: 10, lg: 14 }}
        py={{ base: 10, md: 8 }}
      >
        <Box w="full" maxW="400px">
          <Heading size="lg" color="gray.900">
            Welcome back
          </Heading>
          <Text mt={1} color="gray.500" fontSize="sm">
            Sign in to access your operations dashboard
          </Text>

          <Box as="form" onSubmit={handleSubmit} mt={6}>
            <Stack gap={4}>
              {error && (
                <Box bg="red.50" color="red.700" px={3} py={2.5} borderRadius="md" fontSize="sm">
                  {error}
                </Box>
              )}

              <Field.Root required>
                <Field.Label fontSize="sm" fontWeight="medium">
                  Email address <Field.RequiredIndicator />
                </Field.Label>
                <InputGroup startElement={<FiMail color="gray" />}>
                  <Input
                    type="email"
                    placeholder="Enter email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </InputGroup>
              </Field.Root>

              <Field.Root required>
                <Field.Label fontSize="sm" fontWeight="medium">
                  Password <Field.RequiredIndicator />
                </Field.Label>
                <InputGroup startElement={<FiLock color="gray" />}>
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </InputGroup>
              </Field.Root>

              <Button
                type="submit"
                w="full"
                bg={BRAND.cerulean}
                color="white"
                _hover={{ bg: "brand.700" }}
                size="lg"
                loading={submitting}
              >
                Sign in
              </Button>
            </Stack>
          </Box>

          <Text mt={6} fontSize="xs" color="gray.400" textAlign="center">
            &copy; {new Date().getFullYear()} SUL Solutions. All rights reserved.
          </Text>
        </Box>
      </Flex>
    </Flex>
  );
}
