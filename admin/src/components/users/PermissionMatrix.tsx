import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";

export type PermissionModule = {
  key: string;
  label: string;
  description: string | null;
  permissions: Array<{
    key: string;
    label: string;
    description: string | null;
    dangerous: boolean;
  }>;
};

type Props = {
  catalog: PermissionModule[];
  /** Keys currently effective (checked) */
  effective: Set<string>;
  /** Sources map for badges */
  sources?: Record<string, string[]>;
  /** Grant overrides (explicitly on) */
  grants: Set<string>;
  /** Deny overrides (explicitly off) */
  denies: Set<string>;
  onToggle: (permKey: string, nextChecked: boolean) => void;
  onSelectAllModule: (moduleKey: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  readOnly?: boolean;
};

function sourceBadge(sources: string[] | undefined) {
  if (!sources?.length) return null;
  if (sources.some((s) => s.startsWith("role:"))) {
    return (
      <Badge colorPalette="purple" size="sm" variant="subtle">
        Role
      </Badge>
    );
  }
  if (sources.some((s) => s === "user:grant")) {
    return (
      <Badge colorPalette="green" size="sm" variant="subtle">
        Direct
      </Badge>
    );
  }
  if (sources.some((s) => s === "user:deny")) {
    return (
      <Badge colorPalette="red" size="sm" variant="subtle">
        Denied
      </Badge>
    );
  }
  if (sources.some((s) => s.startsWith("group:"))) {
    return (
      <Badge colorPalette="blue" size="sm" variant="subtle">
        Group
      </Badge>
    );
  }
  return null;
}

export function PermissionMatrix({
  catalog,
  effective,
  sources = {},
  grants,
  denies,
  onToggle,
  onSelectAllModule,
  onSelectAll,
  readOnly = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const modules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((m) => moduleFilter === "all" || m.key === moduleFilter)
      .map((m) => ({
        ...m,
        permissions: m.permissions.filter((p) => {
          if (!q) return true;
          return (
            p.key.toLowerCase().includes(q) ||
            p.label.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((m) => m.permissions.length > 0);
  }, [catalog, search, moduleFilter]);

  const grantedCount = effective.size;
  const totalCount = catalog.reduce((n, m) => n + m.permissions.length, 0);

  return (
    <VStack align="stretch" gap={4}>
      <Flex
        gap={3}
        wrap="wrap"
        align="center"
        justify="space-between"
      >
        <Flex gap={2} flex="1" minW="220px" wrap="wrap">
          <Input
            placeholder="Search permissions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxW="280px"
            bg="white"
          />
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "#E2E8F0",
              borderRadius: 8,
              padding: "8px 12px",
              background: "white",
              fontSize: 14,
              maxWidth: 280,
            }}
          >
            <option value="all">All modules</option>
            {catalog.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Flex>
        <Flex gap={2} align="center">
          <Text fontSize="sm" color="fg.muted">
            {grantedCount} / {totalCount} effective
          </Text>
          {!readOnly ? (
            <>
              <Button size="sm" variant="outline" onClick={() => onSelectAll(true)}>
                Select all
              </Button>
              <Button size="sm" variant="outline" onClick={() => onSelectAll(false)}>
                Clear all
              </Button>
            </>
          ) : null}
        </Flex>
      </Flex>

      {modules.map((mod) => {
        const isCollapsed = collapsed[mod.key];
        const moduleKeys = mod.permissions.map((p) => p.key);
        const allOn = moduleKeys.every((k) => effective.has(k));
        const someOn = moduleKeys.some((k) => effective.has(k));

        return (
          <Box
            key={mod.key}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="lg"
            bg="white"
            overflow="hidden"
          >
            <Flex
              px={4}
              py={3}
              align="center"
              gap={3}
              bg="gray.50"
              borderBottomWidth={isCollapsed ? 0 : "1px"}
              borderColor="gray.200"
            >
              {!readOnly ? (
                <Checkbox.Root
                  checked={allOn ? true : someOn ? "indeterminate" : false}
                  onCheckedChange={(d) =>
                    onSelectAllModule(mod.key, d.checked === true)
                  }
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              ) : null}
              <Box
                flex="1"
                cursor="pointer"
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [mod.key]: !c[mod.key] }))
                }
              >
                <Heading size="sm">{mod.label}</Heading>
                {mod.description ? (
                  <Text fontSize="xs" color="fg.muted">
                    {mod.description}
                  </Text>
                ) : null}
              </Box>
              <Badge variant="outline" size="sm">
                {moduleKeys.filter((k) => effective.has(k)).length}/
                {moduleKeys.length}
              </Badge>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [mod.key]: !c[mod.key] }))
                }
              >
                {isCollapsed ? "Expand" : "Collapse"}
              </Button>
            </Flex>

            {!isCollapsed ? (
              <VStack align="stretch" gap={0} divideY="1px" divideColor="gray.100">
                {mod.permissions.map((perm) => {
                  const checked = effective.has(perm.key);
                  const isGrant = grants.has(perm.key);
                  const isDeny = denies.has(perm.key);
                  return (
                    <Flex
                      key={perm.key}
                      px={4}
                      py={2.5}
                      align="center"
                      gap={3}
                      _hover={{ bg: "gray.50" }}
                    >
                      <Checkbox.Root
                        checked={checked}
                        disabled={readOnly}
                        onCheckedChange={(d) =>
                          onToggle(perm.key, d.checked === true)
                        }
                      >
                        <Checkbox.HiddenInput />
                        <Checkbox.Control />
                      </Checkbox.Root>
                      <Box flex="1" minW={0}>
                        <Flex align="center" gap={2} wrap="wrap">
                          <Text fontSize="sm" fontWeight="medium">
                            {perm.label}
                          </Text>
                          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                            {perm.key}
                          </Text>
                          {perm.dangerous ? (
                            <Badge colorPalette="orange" size="sm">
                              Sensitive
                            </Badge>
                          ) : null}
                          {isGrant ? (
                            <Badge colorPalette="green" size="sm">
                              Override +
                            </Badge>
                          ) : null}
                          {isDeny ? (
                            <Badge colorPalette="red" size="sm">
                              Override −
                            </Badge>
                          ) : null}
                          {sourceBadge(sources[perm.key])}
                        </Flex>
                        {perm.description ? (
                          <Text fontSize="xs" color="fg.muted">
                            {perm.description}
                          </Text>
                        ) : null}
                      </Box>
                    </Flex>
                  );
                })}
              </VStack>
            ) : null}
          </Box>
        );
      })}
    </VStack>
  );
}
