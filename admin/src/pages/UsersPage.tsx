import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiUserPlus } from "react-icons/fi";
import { DisplayText } from "../components/ui/DisplayText";
import { AppDialog } from "../components/ui/AppDialog";
import {
  DataTable,
  DataTableCard,
  dataTableCellProps,
  DataTableColumnHeader,
  DataTableSortHeader,
} from "../components/ui/DataTable";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { useTableSort } from "../hooks/useTableSort";
import { sortRows } from "../lib/tableSort";
import { api, formatDate, type AdminUser } from "../lib/api";
import { roleLabel } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { userExportColumns } from "../lib/dataTableExportColumns";
import {
  exportTableData,
  type ExportFormat,
  type ExportScope,
} from "../lib/tableExport";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { SelectField } from "../components/ui/SelectField";
import {
  EmptyState,
  inlineFormCardProps,
  PAGE_STACK_GAP,
  PageErrorBanner,
  PageHeader,
} from "../components/ui/pageLayout";
import {
  UserActionMenu,
  type UserAction,
} from "../components/users/UserActionMenu";

const CREATE_ROLE_OPTIONS = [
  { value: "admin", label: "Administrator — full access" },
  { value: "support", label: "Customer support — manage customers and agencies" },
  { value: "cfo", label: "CFO — financial ops, billing, and reports" },
  {
    value: "ceo",
    label: "CEO — business reports, customers & payments (read-only)",
  },
  { value: "partner", label: "Partner — read-only dashboard and customer list" },
] as const;

type UserSortKey = "name" | "email" | "role" | "is_active" | "created_at";

function isProtectedAdmin(user: AdminUser) {
  return user.role === "admin";
}

export function UsersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("support");
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { sorts, toggleSort } = useTableSort<UserSortKey>({
    sortBy: "name",
    sortDir: "asc",
  });

  const sortedUsers = useMemo(
    () =>
      sortRows(users, sorts, {
        name: (user) => user.name,
        email: (user) => user.email,
        role: (user) => user.role,
        is_active: (user) => user.is_active,
        created_at: (user) => user.created_at,
      }),
    [users, sorts]
  );

  async function load() {
    setLoading(true);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createUser({ name, email, password, role });
      toaster.create({ title: "User created", type: "success" });
      setName("");
      setEmail("");
      setPassword("");
      setRole("support");
      setShowForm(false);
      load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to create user",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(id: number, newRole: string) {
    try {
      await api.updateUser(id, { role: newRole });
      toaster.create({ title: "Role updated", type: "success" });
      load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Update failed",
        type: "error",
      });
    }
  }

  async function handleToggleActive(id: number, active: boolean) {
    try {
      await api.updateUser(id, { is_active: !active });
      toaster.create({ title: active ? "User deactivated" : "User activated", type: "success" });
      load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Update failed",
        type: "error",
      });
    }
  }

  function openResetPassword(user: AdminUser) {
    setResetUser(user);
    setResetPassword("");
  }

  function closeResetPassword() {
    if (resetting) return;
    setResetUser(null);
    setResetPassword("");
  }

  function handleUserAction(user: AdminUser, action: UserAction) {
    if (action.type === "role") {
      void handleRoleChange(user.id, action.role);
      return;
    }
    if (action.type === "resetPassword") {
      openResetPassword(user);
      return;
    }
    if (action.type === "toggleActive") {
      void handleToggleActive(user.id, !!user.is_active);
    }
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    if (resetPassword.length < 8) {
      toaster.create({
        title: "Password must be at least 8 characters",
        type: "error",
      });
      return;
    }
    setResetting(true);
    try {
      await api.resetUserPassword(resetUser.id, resetPassword);
      toaster.create({
        title: `Password reset for ${resetUser.name}`,
        type: "success",
      });
      setResetUser(null);
      setResetPassword("");
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Password reset failed",
        type: "error",
      });
    } finally {
      setResetting(false);
    }
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      await exportTableData({
        scope,
        format,
        filenameBase: "users",
        title: "Users",
        columns: userExportColumns,
        viewRows: sortedUsers,
        fetchAllRows: async () => sortedUsers,
      });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Export failed",
        type: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title={embedded ? "Users" : "User Management"}
        headingSize={embedded ? "sm" : "lg"}
        sticky={!embedded}
        actions={
          <Flex gap={2} align="center">
            <DataTableExportButton
              entityLabel="users"
              viewCount={sortedUsers.length}
              totalCount={users.length}
              loading={exporting}
              onExport={handleExport}
            />
            <Button
              size={embedded ? "sm" : "md"}
              colorPalette="brand"
              onClick={() => setShowForm(!showForm)}
            >
              <FiUserPlus />
              Add User
            </Button>
          </Flex>
        }
      />

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {showForm ? (
        <Box as="form" onSubmit={handleCreate} {...inlineFormCardProps}>
          <Heading size="sm" mb={4}>
            Create New User
          </Heading>
          <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={4}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field.Root>
            <Field.Root required>
              <Field.Label>Email</Field.Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field.Root>
            <Field.Root required>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field.Root>
            <Field.Root required>
              <Field.Label>Role</Field.Label>
              <SelectField
                fieldProps={{
                  value: role,
                  onChange: (e) => setRole(e.target.value),
                }}
              >
                {CREATE_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
          </Grid>
          <Flex gap={3} mt={4}>
            <Button type="submit" colorPalette="brand" loading={submitting}>
              Create User
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </Flex>
        </Box>
      ) : null}

      <DataTableCard loading={loading} itemLabel="users">
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={1} />}
            desktop={<DataTableLoadingSkeleton columns={6} fill narrowLeading={0} />}
          />
        ) : sortedUsers.length === 0 ? (
          <EmptyState>No users yet</EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={sortedUsers}
                getKey={(u) => u.id}
                renderCard={(u) => (
                  <MobileDataCard
                    title={u.name}
                    subtitle={u.email}
                    trailing={
                      <Flex align="center" gap={1}>
                        <Badge colorPalette={u.is_active ? "green" : "gray"} variant="subtle">
                          {u.is_active ? "Active" : "Inactive"}
                        </Badge>
                        <UserActionMenu
                          user={u}
                          isProtectedAdmin={isProtectedAdmin(u)}
                          onAction={(action) => handleUserAction(u, action)}
                        />
                      </Flex>
                    }
                    showChevron={false}
                    fields={[
                      { label: "Role", value: roleLabel(u.role) },
                      { label: "Created", value: formatDate(u.created_at) },
                    ]}
                  />
                )}
              />
            }
            desktop={
              <DataTable fixedLayout>
                <Table.Header>
                  <Table.Row>
                    <DataTableSortHeader label="Name" column="name" sorts={sorts} onSort={toggleSort} />
                    <DataTableSortHeader label="Email" column="email" sorts={sorts} onSort={toggleSort} />
                    <DataTableSortHeader label="Role" column="role" sorts={sorts} onSort={toggleSort} />
                    <DataTableSortHeader label="Status" column="is_active" sorts={sorts} onSort={toggleSort} />
                    <DataTableSortHeader
                      label="Created"
                      column="created_at"
                      sorts={sorts}
                      onSort={toggleSort}
                      defaultDir="desc"
                    />
                    <DataTableColumnHeader w="56px" textAlign="right">
                      {" "}
                    </DataTableColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {sortedUsers.map((u) => (
                    <Table.Row key={u.id}>
                      <Table.Cell {...dataTableCellProps} fontWeight="medium">
                        <DisplayText value={u.name} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>{u.email}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Text fontSize="sm" color="fg">
                          {roleLabel(u.role)}
                        </Text>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Badge colorPalette={u.is_active ? "green" : "gray"} variant="subtle">
                          {u.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted">
                        {formatDate(u.created_at)}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} textAlign="right" w="56px">
                        <UserActionMenu
                          user={u}
                          isProtectedAdmin={isProtectedAdmin(u)}
                          onAction={(action) => handleUserAction(u, action)}
                        />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
            }
          />
        )}
      </DataTableCard>

      <AppDialog
        open={Boolean(resetUser)}
        onOpenChange={(details) => {
          if (!details.open) closeResetPassword();
        }}
        maxW="md"
      >
        <Box px={5} py={4} borderBottomWidth="1px" borderColor="border.muted">
          <Heading size="sm">Reset password</Heading>
          {resetUser ? (
            <Box fontSize="sm" color="fg.muted" mt={1}>
              Set a new password for {resetUser.name} ({resetUser.email})
            </Box>
          ) : null}
        </Box>
        <Box px={5} py={4}>
          <Field.Root required>
            <Field.Label>New password</Field.Label>
            <Input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
            />
          </Field.Root>
        </Box>
        <Flex
          px={5}
          py={4}
          gap={2}
          justify="flex-end"
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          <Button variant="ghost" disabled={resetting} onClick={closeResetPassword}>
            Cancel
          </Button>
          <Button
            colorPalette="brand"
            loading={resetting}
            onClick={() => void handleResetPassword()}
          >
            Save password
          </Button>
        </Flex>
      </AppDialog>
    </Stack>
  );
}
