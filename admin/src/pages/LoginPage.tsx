import { type FormEvent, useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
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
import { FiActivity, FiLock, FiMail, FiRepeat, FiTrendingUp, FiUsers } from "react-icons/fi";
import { useAuth } from "../lib/auth";
import { toaster } from "../components/ui/toaster";
import { BRAND } from "../theme";

const BRAND_NAME = "SUL Bix";
const COPYRIGHT = "© 2026 SUL Solutions. All rights reserved.";
const HERO_HEADLINE = "A unified hub for customer management and billing";
const HERO_SUBCOPY =
  "Manage subscribers, packages, and buildings; track M-Pesa collections; and keep Zoho and TISP integrations in sync — all in one place.";
const REMEMBER_EMAIL_KEY = "sul-bix-login-email";

/** Decorative figures for the login hero — not live data */
const DEMO_TILE_STATS = {
  transactions: "2,847",
  successRate: "97%",
  returning: "412",
  activeCustomers: "1,856",
  returningPayers: "412",
};

const CHART_BARS = [38, 52, 44, 68, 58, 74, 62, 80, 70, 86, 76, 64];
const CUSTOMER_BARS = [72, 58, 84, 66, 78, 62, 88, 70, 76, 64, 82, 68];

const softInputProps = {
  fontSize: "16px" as const,
  h: "54px",
  borderRadius: "lg" as const,
  bg: "gray.50",
  border: "1px solid" as const,
  borderColor: "gray.100",
  _placeholder: { color: "gray.400" },
  _focusVisible: {
    bg: "white",
    borderColor: BRAND.cerulean,
    boxShadow: `0 0 0 3px rgba(22, 106, 130, 0.15)`,
    outline: "none",
  },
};

const softInputPropsCompact = {
  ...softInputProps,
  h: "44px",
  fontSize: "16px" as const,
  borderRadius: "md" as const,
};

const SPARK_TX = "0,22 8,18 16,20 24,12 32,14 40,8 48,10 56,4";
const SPARK_OK = "0,16 10,14 20,15 30,10 40,11 50,6 56,4";
const SPARK_CU = "0,18 8,16 16,17 24,11 32,13 40,7 48,9 56,5";

function HeroBackdrop() {
  return (
    <>
      {/* Depth gradient */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        background="
          radial-gradient(ellipse 80% 60% at 90% -10%, rgba(109,207,246,0.35), transparent 55%),
          radial-gradient(ellipse 70% 50% at -10% 90%, rgba(234,238,171,0.22), transparent 50%),
          radial-gradient(ellipse 50% 40% at 50% 50%, rgba(249,164,86,0.12), transparent 60%)
        "
      />
      {/* Fine grid */}
      <Box
        position="absolute"
        inset={0}
        opacity={0.1}
        backgroundImage="linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)"
        backgroundSize="28px 28px"
        maskImage="linear-gradient(180deg, white, transparent 90%)"
        pointerEvents="none"
      />
      {/* Soft diagonal sheen */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        opacity={0.2}
        background="linear-gradient(125deg, transparent 35%, rgba(255,255,255,0.18) 48%, transparent 62%)"
        css={{
          animation: "login-sheen 7s ease-in-out infinite",
          "@keyframes login-sheen": {
            "0%, 100%": { transform: "translateX(-8%)" },
            "50%": { transform: "translateX(8%)" },
          },
        }}
      />
      <Box
        position="absolute"
        top="-8%"
        right="-6%"
        w={{ base: "200px", md: "300px" }}
        h={{ base: "200px", md: "300px" }}
        borderRadius="2xl"
        bg="rgba(109,207,246,0.22)"
        filter="blur(2px)"
        transform="rotate(18deg)"
        pointerEvents="none"
      />
      <Box
        position="absolute"
        bottom="8%"
        left="-12%"
        w={{ base: "160px", md: "260px" }}
        h={{ base: "160px", md: "260px" }}
        borderRadius="2xl"
        bg="rgba(234,238,171,0.16)"
        filter="blur(1px)"
        transform="rotate(-14deg)"
        pointerEvents="none"
      />
    </>
  );
}

function MiniSparkline({
  points,
  stroke,
  id,
}: {
  points: string;
  stroke: string;
  id: string;
}) {
  const gradId = `spark-${id}`;
  return (
    <Box h="28px" w="full" mt={2} opacity={0.9}>
      <svg viewBox="0 0 56 24" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.4" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon fill={`url(#${gradId})`} points={`0,24 ${points} 56,24`} />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    </Box>
  );
}

function MiniStatTile({
  label,
  value,
  icon,
  accent,
  top,
  left,
  right,
  delay = 0,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
  top?: string;
  left?: string;
  right?: string;
  delay?: number;
}) {
  return (
    <Box
      position="absolute"
      top={top}
      left={left}
      right={right}
      zIndex={2}
      borderRadius="xl"
      px={3.5}
      py={3}
      minW="136px"
      bg="rgba(255,255,255,0.14)"
      backdropFilter="blur(16px)"
      border="1px solid"
      borderColor="whiteAlpha.400"
      boxShadow={`0 16px 36px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.35)`}
      overflow="hidden"
      css={{
        animation: `login-tile-float 3.4s ease-in-out infinite`,
        animationDelay: `${delay}s`,
        "@keyframes login-tile-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      }}
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        w="3px"
        h="full"
        bg={accent}
        opacity={0.9}
      />
      <Flex align="center" gap={2} mb={1}>
        <Flex
          boxSize="28px"
          borderRadius="md"
          bg={`${accent}33`}
          color="white"
          align="center"
          justify="center"
          flexShrink={0}
        >
          {icon}
        </Flex>
        <Text fontSize="2xs" fontWeight="semibold" color="whiteAlpha.900" lineHeight="1.2">
          {label}
        </Text>
      </Flex>
      <Text fontSize="lg" fontWeight="bold" color="white" lineHeight="1.1">
        {value}
      </Text>
    </Box>
  );
}

/** Mobile hero tiles — glass cards with sparkline accents */
function StatTileCard({
  label,
  value,
  icon,
  accent,
  sparkPoints,
  delay = 0,
  gridColumn,
  wide = false,
  compact = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
  sparkPoints: string;
  delay?: number;
  gridColumn?: string;
  wide?: boolean;
  compact?: boolean;
}) {
  return (
    <Box
      position="relative"
      borderRadius="xl"
      px={compact ? 2.5 : 3.5}
      py={compact ? 2 : 3}
      gridColumn={gridColumn}
      overflow="hidden"
      bg="rgba(255,255,255,0.12)"
      backdropFilter="blur(18px)"
      border="1px solid"
      borderColor="whiteAlpha.350"
      boxShadow="0 14px 32px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28)"
      css={
        compact
          ? undefined
          : {
              "@media (min-width: 48em) and (prefers-reduced-motion: no-preference)": {
                animation: `login-tile-float 3.6s ease-in-out infinite`,
                animationDelay: `${delay}s`,
              },
              "@keyframes login-tile-float": {
                "0%, 100%": { transform: "translateY(0)" },
                "50%": { transform: "translateY(-5px)" },
              },
            }
      }
    >
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        background={`linear-gradient(145deg, ${accent}40 0%, transparent 55%)`}
      />
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        h="2px"
        bg={`linear-gradient(90deg, ${accent}, transparent)`}
        opacity={0.9}
      />

      <Flex align="flex-start" justify="space-between" gap={2} position="relative">
        <Box flex="1" minW={0}>
          <Flex align="center" gap={compact ? 1.5 : 2.5} mb={compact ? 1 : 2}>
            <Flex
              boxSize={compact ? "26px" : "34px"}
              borderRadius="md"
              bg="rgba(255,255,255,0.18)"
              color="white"
              align="center"
              justify="center"
              flexShrink={0}
              border="1px solid"
              borderColor="whiteAlpha.300"
            >
              {icon}
            </Flex>
            <Text
              fontSize={compact ? "2xs" : "xs"}
              fontWeight="semibold"
              color="whiteAlpha.900"
              letterSpacing="0.02em"
              lineHeight="1.2"
            >
              {label}
            </Text>
          </Flex>
          <Text
            fontSize={compact ? "lg" : wide ? "3xl" : "2xl"}
            fontWeight="bold"
            color="white"
            lineHeight="1"
            letterSpacing="-0.02em"
          >
            {value}
          </Text>
        </Box>
        {!compact && wide ? (
          <Box w="42%" maxW="140px" alignSelf="flex-end" pb={0.5}>
            <MiniSparkline id={`${label}-w`.replace(/\s+/g, "-")} points={sparkPoints} stroke={accent} />
          </Box>
        ) : null}
      </Flex>
      {!compact && !wide ? (
        <MiniSparkline id={label.replace(/\s+/g, "-")} points={sparkPoints} stroke={accent} />
      ) : null}
    </Box>
  );
}

function DesktopChartCard() {
  return (
    <Box
      position="absolute"
      top="16%"
      left="50%"
      transform="translateX(-50%)"
      w="88%"
      maxW="340px"
      borderRadius="2xl"
      px={5}
      py={5}
      bg="rgba(255,255,255,0.12)"
      backdropFilter="blur(18px)"
      border="1px solid"
      borderColor="whiteAlpha.350"
      boxShadow="0 20px 48px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.25)"
      zIndex={1}
      overflow="hidden"
      css={{
        animation: "login-chart-float 3.8s ease-in-out infinite",
        "@keyframes login-chart-float": {
          "0%, 100%": { transform: "translateX(-50%) translateY(0)" },
          "50%": { transform: "translateX(-50%) translateY(-10px)" },
        },
      }}
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        h="2px"
        bg={`linear-gradient(90deg, ${BRAND.paleAzure}, transparent)`}
      />
      <Flex justify="space-between" align="center" mb={3}>
        <Text fontSize="sm" fontWeight="semibold" color="white">
          Activity Overview
        </Text>
        <Flex
          align="center"
          gap={1.5}
          px={2}
          py={0.5}
          borderRadius="md"
          bg="rgba(109,207,246,0.2)"
          border="1px solid"
          borderColor="whiteAlpha.300"
        >
          <Box
            boxSize="6px"
            borderRadius="sm"
            bg={BRAND.paleAzure}
            css={{
              animation: "login-pulse 1.6s ease-in-out infinite",
              "@keyframes login-pulse": {
                "0%, 100%": { opacity: 1 },
                "50%": { opacity: 0.35 },
              },
            }}
          />
          <Text fontSize="2xs" color="white" fontWeight="semibold">
            Live
          </Text>
        </Flex>
      </Flex>
      <Flex align="flex-end" gap={1.5} h="84px" mb={3}>
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
            opacity={0.9}
            boxShadow={`0 0 12px ${
              i % 3 === 0
                ? "rgba(109,207,246,0.35)"
                : i % 3 === 1
                  ? "rgba(234,238,171,0.3)"
                  : "rgba(249,164,86,0.3)"
            }`}
          />
        ))}
      </Flex>
      <Box h="36px">
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
    </Box>
  );
}

function DesktopCustomerCard() {
  const barHeights = CUSTOMER_BARS.map((h, i) =>
    Math.max(18, Math.round((h / 100) * (52 + (i % 4) * 8)))
  );

  return (
    <Box
      position="absolute"
      top="48%"
      left="0"
      w="88%"
      maxW="340px"
      borderRadius="2xl"
      px={5}
      py={5}
      bg="rgba(216,238,246,0.88)"
      backdropFilter="blur(12px)"
      border="1px solid"
      borderColor="rgba(255,255,255,0.65)"
      boxShadow="0 20px 48px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.7)"
      zIndex={2}
      overflow="hidden"
      css={{
        animation: "login-customer-float 3.8s ease-in-out infinite",
        animationDelay: "0.75s",
        "@keyframes login-customer-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      }}
    >
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        background={`linear-gradient(145deg, ${BRAND.paleAzure}33 0%, transparent 50%)`}
      />
      <Flex justify="space-between" align="center" mb={3} position="relative">
        <Flex align="center" gap={2}>
          <Flex
            boxSize="32px"
            borderRadius="lg"
            bg="rgba(255,255,255,0.7)"
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
      </Flex>
      <Flex align="flex-end" gap={1.5} h="84px" mb={3} position="relative">
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
      <Flex align="center" justify="space-between" position="relative">
        <Text fontSize="4xl" fontWeight="bold" color={BRAND.cerulean} lineHeight="1">
          {DEMO_TILE_STATS.activeCustomers}
        </Text>
        <Text fontSize="xs" color="#12596d" opacity={0.75} textAlign="right" maxW="120px">
          {DEMO_TILE_STATS.returningPayers} returning payers
        </Text>
      </Flex>
    </Box>
  );
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      try {
        if (rememberMe) localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
        else localStorage.removeItem(REMEMBER_EMAIL_KEY);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  function notifyAccessHelp(kind: "signup" | "forgot") {
    toaster.create({
      title: kind === "signup" ? "Account access" : "Password reset",
      description:
        kind === "signup"
          ? "Ask your administrator to create a SUL Bix account for you."
          : "Ask your administrator to reset your password.",
      type: "info",
    });
  }

  const formFields = (compact = false) => {
    const inputProps = compact ? softInputPropsCompact : softInputProps;
    return (
      <Box as="form" onSubmit={handleSubmit} w="full">
        <Stack gap={compact ? 3 : 4}>
          {error ? (
            <Box bg="red.50" color="red.700" px={3} py={2} borderRadius="md" fontSize="sm">
              {error}
            </Box>
          ) : null}

          <Field.Root required>
            <InputGroup startElement={<FiMail color="gray" size={compact ? 16 : 18} />}>
              <Input
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                {...inputProps}
              />
            </InputGroup>
          </Field.Root>

          <Field.Root required>
            <InputGroup startElement={<FiLock color="gray" size={compact ? 16 : 18} />}>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...inputProps}
              />
            </InputGroup>
          </Field.Root>

          <Flex align="center" justify="space-between" gap={2} flexWrap="nowrap">
            <Checkbox.Root
              checked={rememberMe}
              onCheckedChange={(d) => setRememberMe(Boolean(d.checked))}
              size="sm"
              colorPalette="brand"
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control borderRadius="sm" />
              <Checkbox.Label
                color="gray.500"
                fontWeight="normal"
                fontSize={compact ? "xs" : "sm"}
              >
                Remember Me
              </Checkbox.Label>
            </Checkbox.Root>
            <Button
              type="button"
              variant="plain"
              size="sm"
              color={BRAND.cerulean}
              fontWeight="semibold"
              fontSize={compact ? "xs" : "sm"}
              px={0}
              h="auto"
              minH="unset"
              onClick={() => notifyAccessHelp("forgot")}
            >
              Forgot Password?
            </Button>
          </Flex>

          <Button
            type="submit"
            w="full"
            bg={BRAND.cerulean}
            color="white"
            _hover={{ bg: "brand.700" }}
            _active={{ transform: "scale(0.985)" }}
            size={compact ? "md" : "lg"}
            h={compact ? "44px" : "54px"}
            borderRadius="lg"
            fontWeight="bold"
            fontSize={compact ? "sm" : "md"}
            letterSpacing="0.01em"
            loading={submitting}
            mt={compact ? 1 : 1}
            boxShadow="0 10px 24px rgba(22, 106, 130, 0.28)"
          >
            {compact ? "Sign in" : "Login"}
          </Button>
        </Stack>
      </Box>
    );
  };

  const classicDesktopForm = (
    <Box as="form" onSubmit={handleSubmit} w="full">
      <Stack gap={4}>
        {error ? (
          <Box bg="red.50" color="red.700" px={3} py={2.5} borderRadius="lg" fontSize="sm">
            {error}
          </Box>
        ) : null}

        <Field.Root required>
          <Field.Label fontWeight="medium" color="gray.700" fontSize="sm" mb={1}>
            Email address <Field.RequiredIndicator />
          </Field.Label>
          <InputGroup startElement={<FiMail color="gray" size={16} />}>
            <Input
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="Enter email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fontSize="sm"
              h="44px"
              borderRadius="lg"
              bg="white"
              border="1px solid"
              borderColor="gray.200"
              _placeholder={{ color: "gray.400" }}
              _focusVisible={{
                borderColor: BRAND.cerulean,
                boxShadow: `0 0 0 1px ${BRAND.cerulean}`,
                outline: "none",
              }}
            />
          </InputGroup>
        </Field.Root>

        <Field.Root required>
          <Field.Label fontWeight="medium" color="gray.700" fontSize="sm" mb={1}>
            Password <Field.RequiredIndicator />
          </Field.Label>
          <InputGroup startElement={<FiLock color="gray" size={16} />}>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fontSize="sm"
              h="44px"
              borderRadius="lg"
              bg="white"
              border="1px solid"
              borderColor="gray.200"
              _placeholder={{ color: "gray.400" }}
              _focusVisible={{
                borderColor: BRAND.cerulean,
                boxShadow: `0 0 0 1px ${BRAND.cerulean}`,
                outline: "none",
              }}
            />
          </InputGroup>
        </Field.Root>

        <Button
          type="submit"
          w="full"
          bg={BRAND.cerulean}
          color="white"
          _hover={{ bg: "brand.700" }}
          size="md"
          h="44px"
          borderRadius="lg"
          fontWeight="semibold"
          fontSize="sm"
          loading={submitting}
          mt={1}
        >
          Sign in
        </Button>
      </Stack>
    </Box>
  );

  return (
    <Flex
      h={{ base: "100dvh", md: "auto" }}
      minH={{ base: "100dvh", md: "100dvh" }}
      maxH={{ base: "100dvh", md: "none" }}
      direction={{ base: "column", md: "row" }}
      bg={BRAND.cerulean}
      overflow={{ base: "hidden", md: "visible" }}
    >
      {/* Mobile: compact, scrollable layout that fits short viewports */}
      <Flex
        display={{ base: "flex", md: "none" }}
        flex="1"
        direction="column"
        h="100%"
        maxH="100dvh"
        position="relative"
        overflowX="hidden"
        overflowY="auto"
        css={{
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorY: "contain",
        }}
      >
        <HeroBackdrop />

        <Box
          position="relative"
          zIndex={1}
          flexShrink={0}
          px={4}
          pt="max(1.25rem, env(safe-area-inset-top, 0px))"
          pb={6}
        >
          <Flex align="center" gap={3} mb={6}>
            <Flex
              boxSize="48px"
              borderRadius="xl"
              bg="white"
              align="center"
              justify="center"
              flexShrink={0}
              overflow="hidden"
              p={1.5}
              boxShadow="0 6px 16px rgba(0,0,0,0.16)"
            >
              <Image
                src="/admin/logo.png"
                alt={BRAND_NAME}
                w="100%"
                h="100%"
                objectFit="contain"
                objectPosition="center"
              />
            </Flex>
            <Box minW={0}>
              <Text
                fontWeight="bold"
                color="white"
                fontSize="lg"
                letterSpacing="-0.01em"
                lineHeight="1.2"
              >
                {BRAND_NAME}
              </Text>
              <Text fontSize="sm" color="whiteAlpha.800" lineHeight="1.3" mt={1}>
                Customer & payment operations
              </Text>
            </Box>
          </Flex>

          <Heading
            color="white"
            fontSize="18.5px"
            lineHeight="1.4"
            letterSpacing="-0.02em"
            maxW="19rem"
            mb={6}
            fontWeight="semibold"
          >
            {HERO_HEADLINE}
          </Heading>

          <Box display="grid" gridTemplateColumns="1fr 1fr" gap={3.5} w="full">
            <StatTileCard
              label="Transactions"
              value={DEMO_TILE_STATS.transactions}
              icon={<FiActivity size={15} />}
              accent={BRAND.paleAzure}
              sparkPoints={SPARK_TX}
              delay={0}
            />
            <StatTileCard
              label="Success"
              value={DEMO_TILE_STATS.successRate}
              icon={<FiTrendingUp size={15} />}
              accent={BRAND.mindaro}
              sparkPoints={SPARK_OK}
              delay={0.2}
            />
            <StatTileCard
              label="Customers"
              value={DEMO_TILE_STATS.activeCustomers}
              icon={<FiUsers size={15} />}
              accent={BRAND.sandyBrown}
              sparkPoints={SPARK_CU}
              delay={0.4}
              gridColumn="1 / -1"
              wide
            />
          </Box>
        </Box>

        <Flex
          position="relative"
          zIndex={2}
          direction="column"
          flex="1"
          flexShrink={0}
          mt={2}
          bg="white"
          borderTopRadius="2xl"
          px={5}
          pt={3.5}
          pb="max(1rem, env(safe-area-inset-bottom, 0px))"
          boxShadow="0 -10px 32px rgba(0,0,0,0.14)"
        >
          <Flex justify="center" mb={3} flexShrink={0}>
            <Box w="32px" h="3px" borderRadius="md" bg="gray.200" />
          </Flex>

          <Heading
            fontSize="lg"
            fontWeight="bold"
            color="gray.800"
            letterSpacing="-0.02em"
            mb={1}
            flexShrink={0}
          >
            Welcome back
          </Heading>
          <Text fontSize="xs" color="gray.500" mb={3.5} lineHeight="1.4" flexShrink={0}>
            Sign in to access your operations dashboard
          </Text>

          <Box flexShrink={0}>{formFields(true)}</Box>

          <Text mt={4} mb={1} fontSize="2xs" color="gray.400" textAlign="center" flexShrink={0}>
            {COPYRIGHT}
          </Text>
        </Flex>
      </Flex>

      {/* Desktop: equal split — tiles | login */}
      <Flex
        display={{ base: "none", md: "flex" }}
        flex="1"
        direction="column"
        justify="space-between"
        bg={BRAND.cerulean}
        px={{ md: 10, lg: 14 }}
        py={{ md: 10, lg: 12 }}
        minH="100dvh"
        position="relative"
        overflow="hidden"
      >
        <HeroBackdrop />

        <Flex align="center" gap={4} zIndex={1}>
          <Flex
            boxSize="68px"
            borderRadius="xl"
            bg="white"
            align="center"
            justify="center"
            flexShrink={0}
            overflow="hidden"
            p={2}
            boxShadow="0 10px 24px rgba(0,0,0,0.2)"
          >
            <Image
              src="/admin/logo.png"
              alt={BRAND_NAME}
              w="100%"
              h="100%"
              objectFit="contain"
              objectPosition="center"
            />
          </Flex>
          <Box>
            <Text fontWeight="bold" color="white" fontSize="2xl" letterSpacing="-0.01em" lineHeight="1.15">
              {BRAND_NAME}
            </Text>
            <Text fontSize="md" color="whiteAlpha.800" mt={1}>
              Customer & payment operations
            </Text>
          </Box>
        </Flex>

        <Box
          position="relative"
          flex="1"
          w="full"
          maxW="480px"
          mx="auto"
          minH="380px"
          my={8}
          zIndex={1}
        >
          <DesktopChartCard />
          <DesktopCustomerCard />
          <MiniStatTile
            label="Transactions"
            value={DEMO_TILE_STATS.transactions}
            icon={<FiActivity size={16} />}
            accent={BRAND.paleAzure}
            top="4%"
            left="0"
            delay={0}
          />
          <MiniStatTile
            label="Success Rate"
            value={DEMO_TILE_STATS.successRate}
            icon={<FiTrendingUp size={16} />}
            accent={BRAND.mindaro}
            top="4%"
            right="0"
            delay={0.5}
          />
          <MiniStatTile
            label="Returning"
            value={DEMO_TILE_STATS.returning}
            icon={<FiRepeat size={16} />}
            accent={BRAND.sandyBrown}
            top="62%"
            right="0"
            delay={1}
          />
        </Box>

        <Box zIndex={1}>
          <Heading size="xl" color="white" lineHeight="1.45" maxW="md">
            {HERO_HEADLINE}
          </Heading>
          <Text mt={3} color="whiteAlpha.800" maxW="md" fontSize="sm" lineHeight="1.65">
            {HERO_SUBCOPY}
          </Text>
        </Box>
      </Flex>

      {/* Desktop: classic white welcome form — hero/tiles unchanged */}
      <Flex
        display={{ base: "none", md: "flex" }}
        flex="1"
        align="center"
        justify="center"
        bg="white"
        px={{ md: 10, lg: 14 }}
        py={10}
        minH="100dvh"
      >
        <Box w="full" maxW="400px">
          <Heading
            fontSize="2xl"
            fontWeight="bold"
            color="gray.800"
            letterSpacing="-0.02em"
            mb={1.5}
          >
            Welcome back
          </Heading>
          <Text fontSize="sm" color="gray.500" mb={7} lineHeight="1.5">
            Sign in to access your operations dashboard
          </Text>
          {classicDesktopForm}
          <Text mt={8} fontSize="xs" color="gray.400" textAlign="center">
            {COPYRIGHT}
          </Text>
        </Box>
      </Flex>
    </Flex>
  );
}
