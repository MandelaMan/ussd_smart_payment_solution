import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { FiShield, FiUserPlus, FiUsers, FiCopy, FiMail, FiCheck } from "react-icons/fi";
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
import { api, type AdminUser } from "../lib/api";
import { isAdministrator, roleLabel } from "../lib/rbac";
import { useAuth } from "../lib/authContext";
import { PasswordStrengthMeter } from "../components/ui/PasswordStrengthMeter";
import { toaster } from "../components/ui/toaster";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { userExportColumns } from "../lib/dataTableExportColumns";
import {
  exportTableData,
  type ExportFormat,
  type ExportScope,
} from "../lib/tableExport";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { SelectField } from "../components/ui/SelectField";
import {
  EmptyState,
  inlineFormCardProps,
  ListPageStack,
  PageErrorBanner,
} from "../components/ui/pageLayout";
import {
  UserActionMenu,
  type UserAction,
} from "../components/users/UserActionMenu";
import {
  PermissionMatrix,
  type PermissionModule,
} from "../components/users/PermissionMatrix";

const CREATE_ROLE_OPTIONS = [
  { value: "user", label: "User — permission & group based access" },
  { value: "admin", label: "Administrator — full system access by default" },
] as const;

type UserSortKey = "name" | "email" | "role" | "is_active" | "created_at";

type GroupOption = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  permissions: string[];
  memberCount: number;
  isSystem?: boolean;
};

function isProtectedAdmin(user: AdminUser) {
  return user.role === "admin";
}

function validateManualPassword(password: string, confirm: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (password.length > 128) {
    return "Password must be at most 128 characters";
  }
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    return "Password must include at least one letter and one number";
  }
  if (password !== confirm) {
    return "Passwords do not match";
  }
  return null;
}

export function UsersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { user: currentUser, impersonate } = useAuth();
  const viewerIsAdmin = isAdministrator(currentUser);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [catalog, setCatalog] = useState<PermissionModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [section, setSection] = useState<"users" | "groups">("users");

  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [notes, setNotes] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [createSetPassword, setCreateSetPassword] = useState(false);
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState("");
  const [tempReveal, setTempReveal] = useState<{
    userId: number;
    name: string;
    email: string;
    password: string;
  } | null>(null);
  const [copiedTemp, setCopiedTemp] = useState(false);
  const [emailingTemp, setEmailingTemp] = useState(false);

  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetSetPassword, setResetSetPassword] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [impersonateUser, setImpersonateUser] = useState<AdminUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRole, setEditRole] = useState("user");
  const [editGroupIds, setEditGroupIds] = useState<number[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const [permUser, setPermUser] = useState<AdminUser | null>(null);
  const [permEffective, setPermEffective] = useState<Set<string>>(new Set());
  const [permSources, setPermSources] = useState<Record<string, string[]>>({});
  const [permGrants, setPermGrants] = useState<Set<string>>(new Set());
  const [permDenies, setPermDenies] = useState<Set<string>>(new Set());
  const [permCatalog, setPermCatalog] = useState<PermissionModule[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);
  const [loadingPerms, setLoadingPerms] = useState(false);

  const [editGroup, setEditGroup] = useState<GroupOption | null>(null);
  const [groupPermKeys, setGroupPermKeys] = useState<Set<string>>(new Set());
  const [savingGroup, setSavingGroup] = useState(false);
  const emptyOverrideSet = useMemo(() => new Set<string>(), []);

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, groupsRes, catalogRes] = await Promise.all([
        api.listUsers(),
        api.listGroups().catch(() => ({ groups: [] })),
        api.getPermissionCatalog().catch(() => ({ modules: [] })),
      ]);
      setUsers(usersRes.users);
      setGroups(groupsRes.groups);
      setCatalog(catalogRes.modules);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleGroupId(
    ids: number[],
    setIds: (next: number[]) => void,
    id: number
  ) {
    setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  function clearCreatePasswordFields() {
    setCreateSetPassword(false);
    setCreatePassword("");
    setCreatePasswordConfirm("");
  }

  function clearResetPasswordFields() {
    setResetSetPassword(false);
    setResetPassword("");
    setResetPasswordConfirm("");
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (createSetPassword) {
      const passwordError = validateManualPassword(
        createPassword,
        createPasswordConfirm
      );
      if (passwordError) {
        toaster.create({ title: passwordError, type: "error" });
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api.createUser({
        name,
        email,
        role,
        jobTitle: jobTitle || undefined,
        notes: notes || undefined,
        groupIds: selectedGroupIds,
        ...(createSetPassword ? { password: createPassword } : {}),
      });
      setTempReveal({
        userId: res.id,
        name,
        email: email.trim(),
        password: res.temporaryPassword || createPassword,
      });
      setCopiedTemp(false);
      toaster.create({ title: "User created", type: "success" });
      setName("");
      setJobTitle("");
      setEmail("");
      setNotes("");
      setRole("user");
      setSelectedGroupIds([]);
      clearCreatePasswordFields();
      setShowForm(false);
      void load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to create user",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function openPermissions(user: AdminUser) {
    setPermUser(user);
    setLoadingPerms(true);
    try {
      const res = await api.getUserPermissions(user.id);
      setPermCatalog(res.catalog);
      setPermEffective(new Set(res.permissions));
      setPermSources(res.sources);
      setPermGrants(
        new Set(res.overrides.filter((o) => o.effect === "grant").map((o) => o.key))
      );
      setPermDenies(
        new Set(res.overrides.filter((o) => o.effect === "deny").map((o) => o.key))
      );
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to load permissions",
        type: "error",
      });
      setPermUser(null);
    } finally {
      setLoadingPerms(false);
    }
  }

  function computeOverrideToggle(
    key: string,
    nextChecked: boolean,
    role: string,
    grants: Set<string>,
    denies: Set<string>
  ) {
    const nextGrants = new Set(grants);
    const nextDenies = new Set(denies);
    nextGrants.delete(key);
    nextDenies.delete(key);

    // For admins, unchecking = deny; checking after deny = remove deny.
    // For users, checking when not inherited = grant; unchecking inherited = deny.
    if (role === "admin") {
      if (!nextChecked) nextDenies.add(key);
    } else if (nextChecked) {
      nextGrants.add(key);
    } else {
      nextDenies.add(key);
    }
    return { nextGrants, nextDenies };
  }

  function handlePermToggle(key: string, nextChecked: boolean) {
    if (!permUser) return;
    const { nextGrants, nextDenies } = computeOverrideToggle(
      key,
      nextChecked,
      permUser.role,
      permGrants,
      permDenies
    );
    setPermGrants(nextGrants);
    setPermDenies(nextDenies);
    setPermEffective((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function handleSelectAllModule(moduleKey: string, checked: boolean) {
    const mod = permCatalog.find((m) => m.key === moduleKey);
    if (!mod || !permUser) return;
    let grants = new Set(permGrants);
    let denies = new Set(permDenies);
    const effective = new Set(permEffective);
    for (const p of mod.permissions) {
      const result = computeOverrideToggle(
        p.key,
        checked,
        permUser.role,
        grants,
        denies
      );
      grants = result.nextGrants;
      denies = result.nextDenies;
      if (checked) effective.add(p.key);
      else effective.delete(p.key);
    }
    setPermGrants(grants);
    setPermDenies(denies);
    setPermEffective(effective);
  }

  function handleSelectAll(checked: boolean) {
    if (!permUser) return;
    let grants = new Set(permGrants);
    let denies = new Set(permDenies);
    const effective = new Set<string>();
    for (const mod of permCatalog) {
      for (const p of mod.permissions) {
        const result = computeOverrideToggle(
          p.key,
          checked,
          permUser.role,
          grants,
          denies
        );
        grants = result.nextGrants;
        denies = result.nextDenies;
        if (checked) effective.add(p.key);
      }
    }
    setPermGrants(grants);
    setPermDenies(denies);
    setPermEffective(effective);
  }

  async function savePermissions() {
    if (!permUser) return;
    setSavingPerms(true);
    try {
      const res = await api.setUserPermissions(permUser.id, {
        grants: [...permGrants],
        denies: [...permDenies],
      });
      setPermEffective(new Set(res.permissions));
      setPermSources(res.sources);
      toaster.create({ title: "Permissions saved", type: "success" });
      setPermUser(null);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to save permissions",
        type: "error",
      });
    } finally {
      setSavingPerms(false);
    }
  }

  function openEdit(user: AdminUser) {
    setEditUser(user);
    setEditName(user.name || "");
    setEditJobTitle(user.jobTitle || "");
    setEditNotes(user.notes || "");
    setEditRole(user.role === "admin" ? "admin" : "user");
    setEditGroupIds((user.groups || []).map((g) => g.id));
  }

  async function saveEdit() {
    if (!editUser) return;
    setSavingEdit(true);
    try {
      await api.updateUser(editUser.id, {
        name: editName.trim(),
        jobTitle: editJobTitle.trim() || null,
        notes: editNotes.trim() || null,
        role: editRole,
        groupIds: editGroupIds,
      });
      toaster.create({ title: "User updated", type: "success" });
      setEditUser(null);
      void load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Update failed",
        type: "error",
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleActive(id: number, active: boolean) {
    try {
      await api.updateUser(id, { is_active: !active });
      toaster.create({
        title: active ? "User disabled" : "User activated",
        type: "success",
      });
      void load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Update failed",
        type: "error",
      });
    }
  }

  async function handleRoleChange(id: number, newRole: string) {
    try {
      await api.updateUser(id, { role: newRole });
      toaster.create({ title: "Role updated", type: "success" });
      void load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Update failed",
        type: "error",
      });
    }
  }

  function handleUserAction(user: AdminUser, action: UserAction) {
    if (action.type === "editName" || action.type === "editUser") {
      openEdit(user);
      return;
    }
    if (action.type === "permissions") {
      void openPermissions(user);
      return;
    }
    if (action.type === "impersonate") {
      setImpersonateUser(user);
      return;
    }
    if (action.type === "role") {
      void handleRoleChange(user.id, action.role);
      return;
    }
    if (action.type === "resetPassword") {
      clearResetPasswordFields();
      setResetUser(user);
      return;
    }
    if (action.type === "toggleActive") {
      void handleToggleActive(user.id, !!user.is_active);
    }
  }

  function impersonateDisabledReason(user: AdminUser) {
    if (user.id === currentUser?.id) return "You cannot impersonate yourself";
    if (!user.is_active) return "Cannot impersonate a disabled user";
    return null;
  }

  async function handleConfirmImpersonate() {
    if (!impersonateUser) return;
    setImpersonating(true);
    try {
      await impersonate(impersonateUser.id);
      toaster.create({
        title: `Now viewing as ${impersonateUser.name}`,
        type: "success",
      });
      setImpersonateUser(null);
      navigate("/", { replace: true });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Impersonation failed",
        type: "error",
      });
    } finally {
      setImpersonating(false);
    }
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    if (resetSetPassword) {
      const passwordError = validateManualPassword(
        resetPassword,
        resetPasswordConfirm
      );
      if (passwordError) {
        toaster.create({ title: passwordError, type: "error" });
        return;
      }
    }
    setResetting(true);
    try {
      const res = await api.resetUserPassword(
        resetUser.id,
        resetSetPassword ? { password: resetPassword } : undefined
      );
      const password = res.temporaryPassword || resetPassword;
      if (password) {
        setTempReveal({
          userId: resetUser.id,
          name: resetUser.name,
          email: resetUser.email,
          password,
        });
        setCopiedTemp(false);
      }
      toaster.create({
        title: `Password reset for ${resetUser.name}`,
        type: "success",
      });
      clearResetPasswordFields();
      setResetUser(null);
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Password reset failed",
        type: "error",
      });
    } finally {
      setResetting(false);
    }
  }

  async function copyTempPassword() {
    if (!tempReveal?.password) return;
    try {
      await navigator.clipboard.writeText(tempReveal.password);
      setCopiedTemp(true);
      toaster.create({ title: "Password copied", type: "success" });
      window.setTimeout(() => setCopiedTemp(false), 2000);
    } catch {
      toaster.create({ title: "Could not copy password", type: "error" });
    }
  }

  async function emailTempPassword() {
    if (!tempReveal) return;
    setEmailingTemp(true);
    try {
      await api.emailTemporaryPassword(tempReveal.userId, tempReveal.password);
      toaster.create({
        title: `Temporary password emailed to ${tempReveal.email}`,
        type: "success",
      });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to email password",
        type: "error",
      });
    } finally {
      setEmailingTemp(false);
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

  function openGroupPermissions(group: GroupOption) {
    setEditGroup(group);
    setGroupPermKeys(new Set(group.permissions));
  }

  function handleGroupPermToggle(key: string, nextChecked: boolean) {
    setGroupPermKeys((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function handleGroupSelectAllModule(moduleKey: string, checked: boolean) {
    const mod = catalog.find((m) => m.key === moduleKey);
    if (!mod) return;
    setGroupPermKeys((prev) => {
      const next = new Set(prev);
      for (const p of mod.permissions) {
        if (checked) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });
  }

  function handleGroupSelectAll(checked: boolean) {
    if (!checked) {
      setGroupPermKeys(new Set());
      return;
    }
    const next = new Set<string>();
    for (const mod of catalog) {
      for (const p of mod.permissions) next.add(p.key);
    }
    setGroupPermKeys(next);
  }

  async function saveGroupPermissions() {
    if (!editGroup) return;
    setSavingGroup(true);
    try {
      await api.updateGroup(editGroup.id, {
        permissions: Array.from(groupPermKeys),
      });
      toaster.create({
        title: "Group permissions updated",
        description: "Affected users should refresh the admin app to see nav changes.",
        type: "success",
      });
      setEditGroup(null);
      await load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to update group",
        type: "error",
      });
    } finally {
      setSavingGroup(false);
    }
  }

  function renderGroupPicker(
    selected: number[],
    onChange: (ids: number[]) => void
  ) {
    return (
      <VStack align="stretch" gap={2} maxH="180px" overflowY="auto">
        {groups.map((g) => (
          <Checkbox.Root
            key={g.id}
            checked={selected.includes(g.id)}
            onCheckedChange={() => toggleGroupId(selected, onChange, g.id)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Box flex="1" minW={0}>
              <Text fontWeight="medium" fontSize="sm">
                {g.name}
              </Text>
              {g.description ? (
                <Text fontSize="xs" color="fg.muted">
                  {g.description}
                </Text>
              ) : null}
            </Box>
          </Checkbox.Root>
        ))}
        {!groups.length ? (
          <Text fontSize="sm" color="fg.muted">
            No groups available yet.
          </Text>
        ) : null}
      </VStack>
    );
  }

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome>
            <Flex justify="space-between" align="center" gap={2} flexWrap="wrap" minW={0}>
              <Flex gap={2} align="center">
                <Heading size="sm">
                  {embedded ? "Users & permissions" : "Users"}
                </Heading>
                <Button
                  size="xs"
                  variant={section === "users" ? "solid" : "outline"}
                  colorPalette="brand"
                  onClick={() => setSection("users")}
                >
                  <FiUsers /> Users
                </Button>
                <Button
                  size="xs"
                  variant={section === "groups" ? "solid" : "outline"}
                  onClick={() => setSection("groups")}
                >
                  <FiShield /> Groups
                </Button>
              </Flex>
              <Flex gap={2} align="center">
                {section === "users" ? (
                  <>
                    <DataTableExportButton
                      entityLabel="users"
                      viewCount={sortedUsers.length}
                      totalCount={users.length}
                      loading={exporting}
                      onExport={handleExport}
                    />
                    <Button
                      size="sm"
                      colorPalette="brand"
                      onClick={() => {
                        if (showForm) clearCreatePasswordFields();
                        setShowForm(!showForm);
                      }}
                    >
                      <FiUserPlus />
                      Add User
                    </Button>
                  </>
                ) : null}
              </Flex>
            </Flex>
          </ListPageStickyChrome>
        }
      >
        {!embedded ? (
          <MobilePageChrome title="Users" />
        ) : null}

        {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

        {section === "groups" ? (
          <DataTableCard>
            <VStack align="stretch" gap={3} p={4}>
              <Text fontSize="sm" color="fg.muted">
                Assigning a user to a group grants that group&apos;s permissions.
                Individual overrides on a user always take precedence.
              </Text>
              {groups.map((g) => (
                <Box
                  key={g.id}
                  borderWidth="1px"
                  borderColor="gray.200"
                  borderRadius="md"
                  p={4}
                >
                  <Flex justify="space-between" gap={3} align="flex-start" wrap="wrap">
                    <Box flex="1" minW={0}>
                      <Flex align="center" gap={2} wrap="wrap">
                        <Heading size="sm">{g.name}</Heading>
                        {g.isSystem ? (
                          <Badge colorPalette="blue" size="sm" variant="subtle">
                            System
                          </Badge>
                        ) : null}
                      </Flex>
                      <Text fontSize="sm" color="fg.muted">
                        {g.description}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" mt={1}>
                        {g.memberCount} members · {g.permissions.length} permissions
                      </Text>
                    </Box>
                    <Button
                      size="sm"
                      variant="outline"
                      flexShrink={0}
                      onClick={() => openGroupPermissions(g)}
                    >
                      <FiShield />
                      Edit permissions
                    </Button>
                  </Flex>
                </Box>
              ))}
              {!groups.length && !loading ? (
                <EmptyState>No groups yet — they appear after RBAC sync.</EmptyState>
              ) : null}
            </VStack>
          </DataTableCard>
        ) : (
          <>
            {showForm ? (
              <Box as="form" onSubmit={handleCreate} {...inlineFormCardProps}>
                <Heading size="sm" mb={3}>
                  Create user
                </Heading>
                <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3}>
                  <Field.Root required>
                    <Field.Label>Full name</Field.Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Job title</Field.Label>
                    <Input
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="e.g. Support Agent"
                    />
                  </Field.Root>
                  <Field.Root required>
                    <Field.Label>Email</Field.Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Field.Root>
                  <Field.Root required>
                    <Field.Label>System role</Field.Label>
                    <SelectField
                      fieldProps={{
                        value: role,
                        onChange: (e) => {
                          const next = e.target.value;
                          setRole(next);
                          if (next === "admin") setSelectedGroupIds([]);
                        },
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
                <Box mt={3}>
                  <Text fontSize="sm" fontWeight="medium" mb={2}>
                    User groups
                  </Text>
                  {role === "admin" ? (
                    <Text fontSize="sm" color="fg.muted">
                      Administrators automatically have access to all modules.
                      Groups are optional and do not limit their access.
                    </Text>
                  ) : (
                    renderGroupPicker(selectedGroupIds, setSelectedGroupIds)
                  )}
                </Box>
                <Field.Root mt={3}>
                  <Field.Label>Notes (optional)</Field.Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </Field.Root>
                <Box mt={3}>
                  <Checkbox.Root
                    checked={createSetPassword}
                    onCheckedChange={(details) => {
                      const next = !!details.checked;
                      setCreateSetPassword(next);
                      if (!next) {
                        setCreatePassword("");
                        setCreatePasswordConfirm("");
                      }
                    }}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Text fontSize="sm" fontWeight="medium">
                      Set password manually
                    </Text>
                  </Checkbox.Root>
                  {createSetPassword ? (
                    <Grid
                      templateColumns={{ base: "1fr", md: "1fr 1fr" }}
                      gap={3}
                      mt={3}
                    >
                      <Field.Root required>
                        <Field.Label>New password</Field.Label>
                        <Input
                          type="password"
                          value={createPassword}
                          onChange={(e) => setCreatePassword(e.target.value)}
                          autoComplete="new-password"
                          required
                        />
                        <PasswordStrengthMeter password={createPassword} />
                      </Field.Root>
                      <Field.Root required>
                        <Field.Label>Confirm password</Field.Label>
                        <Input
                          type="password"
                          value={createPasswordConfirm}
                          onChange={(e) =>
                            setCreatePasswordConfirm(e.target.value)
                          }
                          autoComplete="new-password"
                          required
                        />
                      </Field.Root>
                    </Grid>
                  ) : (
                    <Text fontSize="sm" color="fg.muted" mt={2}>
                      A strong temporary password is generated automatically —
                      you can copy it or email it to the user. The user must
                      change it on first login.
                    </Text>
                  )}
                </Box>
                <Flex gap={2} mt={4}>
                  <Button type="submit" colorPalette="brand" loading={submitting}>
                    Create user
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      clearCreatePasswordFields();
                      setShowForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </Flex>
              </Box>
            ) : null}

            <DataTableCard>
              {loading ? (
                <ResponsiveListViews
                  fill
                  mobile={<MobileCardListSkeleton fill variant="card" fieldCount={2} />}
                  desktop={<DataTableLoadingSkeleton columns={7} fill />}
                />
              ) : sortedUsers.length === 0 ? (
                <EmptyState>No users yet. Create the first admin user to get started.</EmptyState>
              ) : (
                <ResponsiveListViews
                  mobile={
                    <MobileDataList
                      items={sortedUsers}
                      getKey={(user) => user.id}
                      renderCard={(user) => (
                        <MobileDataCard
                          title={user.name}
                          subtitle={user.email}
                          statusLine={
                            <Text fontSize="xs" color="fg.muted">
                              {roleLabel(user.role)} ·{" "}
                              {user.is_active ? "Active" : "Disabled"}
                              {user.jobTitle ? ` · ${user.jobTitle}` : ""}
                            </Text>
                          }
                          menu={
                            <UserActionMenu
                              user={user}
                              isProtectedAdmin={isProtectedAdmin(user)}
                              showImpersonate={viewerIsAdmin}
                              impersonateDisabledReason={impersonateDisabledReason(user)}
                              onAction={(action) => handleUserAction(user, action)}
                            />
                          }
                          fields={[
                            {
                              label: "Groups",
                              value:
                                user.role === "admin"
                                  ? "All"
                                  : (user.groups || [])
                                      .map((g) => g.name)
                                      .join(", ") || "—",
                            },
                          ]}
                        />
                      )}
                    />
                  }
                  desktop={
                    <DataTable>
                      <Table.Header>
                        <Table.Row>
                          <DataTableSortHeader
                            label="Name"
                            column="name"
                            sorts={sorts}
                            onSort={toggleSort}
                          />
                          <DataTableColumnHeader>Job title</DataTableColumnHeader>
                          <DataTableSortHeader
                            label="Email"
                            column="email"
                            sorts={sorts}
                            onSort={toggleSort}
                          />
                          <DataTableSortHeader
                            label="Role"
                            column="role"
                            sorts={sorts}
                            onSort={toggleSort}
                          />
                          <DataTableColumnHeader>Groups</DataTableColumnHeader>
                          <DataTableSortHeader
                            label="Status"
                            column="is_active"
                            sorts={sorts}
                            onSort={toggleSort}
                          />
                          <DataTableColumnHeader>Actions</DataTableColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {sortedUsers.map((user) => (
                          <Table.Row key={user.id}>
                            <Table.Cell {...dataTableCellProps}>
                              <DisplayText value={user.name} fontWeight="semibold" />
                            </Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              <Text fontSize="sm" color="fg.muted">
                                {user.jobTitle || "—"}
                              </Text>
                            </Table.Cell>
                            <Table.Cell {...dataTableCellProps}>{user.email}</Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              <Badge
                                colorPalette={user.role === "admin" ? "purple" : "gray"}
                                variant="subtle"
                              >
                                {roleLabel(user.role)}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              <Flex gap={1} wrap="wrap">
                                {user.role === "admin" ? (
                                  <Badge colorPalette="purple" variant="subtle" size="sm">
                                    All
                                  </Badge>
                                ) : (user.groups || []).length ? (
                                  user.groups!.map((g) => (
                                    <Badge key={g.id} variant="outline" size="sm">
                                      {g.name}
                                    </Badge>
                                  ))
                                ) : (
                                  <Text fontSize="sm" color="fg.muted">
                                    —
                                  </Text>
                                )}
                              </Flex>
                            </Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              <Badge
                                colorPalette={user.is_active ? "green" : "red"}
                                variant="subtle"
                              >
                                {user.is_active ? "Active" : "Disabled"}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              <UserActionMenu
                                user={user}
                                isProtectedAdmin={isProtectedAdmin(user)}
                                showImpersonate={viewerIsAdmin}
                                impersonateDisabledReason={impersonateDisabledReason(user)}
                                onAction={(action) => handleUserAction(user, action)}
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
          </>
        )}
      </ListPageTableSection>

      <AppDialog
        open={!!editUser}
        onOpenChange={(details) => {
          if (!details.open && !savingEdit) setEditUser(null);
        }}
        maxW="lg"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>{editUser ? `Edit ${editUser.name}` : "Edit user"}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Field.Root required>
              <Field.Label>Full name</Field.Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field.Root>
            <Field.Root>
              <Field.Label>Job title</Field.Label>
              <Input value={editJobTitle} onChange={(e) => setEditJobTitle(e.target.value)} />
            </Field.Root>
            <Field.Root>
              <Field.Label>System role</Field.Label>
              <SelectField
                fieldProps={{
                  value: editRole,
                  onChange: (e) => {
                    const next = e.target.value;
                    setEditRole(next);
                    if (next === "admin") setEditGroupIds([]);
                  },
                }}
              >
                {CREATE_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
            <Box>
              <Text fontSize="sm" fontWeight="medium" mb={2}>
                Groups
              </Text>
              {editRole === "admin" ? (
                <Text fontSize="sm" color="fg.muted">
                  Administrators automatically have access to all modules. Groups
                  are optional and do not limit their access.
                </Text>
              ) : (
                renderGroupPicker(editGroupIds, setEditGroupIds)
              )}
            </Box>
            <Field.Root>
              <Field.Label>Notes</Field.Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Flex gap={2} justify="flex-end" w="full">
            <Button variant="outline" onClick={() => setEditUser(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button colorPalette="brand" loading={savingEdit} onClick={() => void saveEdit()}>
              Save
            </Button>
          </Flex>
        </Dialog.Footer>
      </AppDialog>

      <AppDialog
        open={!!editGroup}
        onOpenChange={(details) => {
          if (!details.open && !savingGroup) setEditGroup(null);
        }}
        maxW="4xl"
        nearFullScreen
      >
        <Dialog.Header pr={12} flexShrink={0}>
          <Dialog.Title>
            {editGroup ? `Group permissions · ${editGroup.name}` : "Group permissions"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body overflowY="auto" flex="1" minH={0}>
          <Text fontSize="sm" color="fg.muted" mb={3}>
            Members of this group inherit every permission checked below. Individual
            user overrides still take precedence.
          </Text>
          <PermissionMatrix
            catalog={catalog}
            effective={groupPermKeys}
            grants={emptyOverrideSet}
            denies={emptyOverrideSet}
            onToggle={handleGroupPermToggle}
            onSelectAllModule={handleGroupSelectAllModule}
            onSelectAll={handleGroupSelectAll}
          />
        </Dialog.Body>
        <Dialog.Footer flexShrink={0}>
          <Flex gap={2} justify="flex-end" w="full">
            <Button
              variant="outline"
              onClick={() => setEditGroup(null)}
              disabled={savingGroup}
            >
              Cancel
            </Button>
            <Button
              colorPalette="brand"
              loading={savingGroup}
              onClick={() => void saveGroupPermissions()}
            >
              Save permissions
            </Button>
          </Flex>
        </Dialog.Footer>
      </AppDialog>

      <AppDialog
        open={!!permUser}
        onOpenChange={(details) => {
          if (!details.open && !savingPerms) setPermUser(null);
        }}
        maxW="4xl"
        nearFullScreen
      >
        <Dialog.Header pr={12} flexShrink={0}>
          <Dialog.Title>
            {permUser ? `Permissions · ${permUser.name}` : "Permissions"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body overflowY="auto" flex="1" minH={0}>
          {loadingPerms ? (
            <Text color="fg.muted">Loading permission matrix…</Text>
          ) : permUser?.role === "admin" ? (
            <Text fontSize="sm" color="fg.muted">
              Administrators automatically have access to all modules. Individual
              permission overrides are not applied. Change the system role to User
              if you need group-based or override-based access.
            </Text>
          ) : (
            <Box>
              <Text fontSize="sm" color="fg.muted" mb={3}>
                Effective access comes from the system role, group membership, then
                individual overrides. Toggles here set direct grants or denies.
              </Text>
              <PermissionMatrix
                catalog={permCatalog.length ? permCatalog : catalog}
                effective={permEffective}
                sources={permSources}
                grants={permGrants}
                denies={permDenies}
                onToggle={handlePermToggle}
                onSelectAllModule={handleSelectAllModule}
                onSelectAll={handleSelectAll}
              />
            </Box>
          )}
        </Dialog.Body>
        <Dialog.Footer flexShrink={0}>
          <Flex gap={2} justify="flex-end" w="full">
            <Button variant="outline" onClick={() => setPermUser(null)} disabled={savingPerms}>
              {permUser?.role === "admin" ? "Close" : "Cancel"}
            </Button>
            {permUser?.role === "admin" ? null : (
              <Button colorPalette="brand" loading={savingPerms} onClick={() => void savePermissions()}>
                Save permissions
              </Button>
            )}
          </Flex>
        </Dialog.Footer>
      </AppDialog>

      <AppDialog
        open={!!impersonateUser}
        onOpenChange={(details) => {
          if (!details.open && !impersonating) setImpersonateUser(null);
        }}
        maxW="md"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>
            {impersonateUser
              ? `Impersonate ${impersonateUser.name}`
              : "Impersonate user"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" color="fg.muted">
            You will see the admin app exactly as{" "}
            <Text as="span" fontWeight="medium" color="fg">
              {impersonateUser?.name}
            </Text>
            {impersonateUser?.email ? ` (${impersonateUser.email})` : ""} does —
            including menus, pages, and permissions. Your administrator session
            is restored when you stop impersonating.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Flex gap={2} justify="flex-end" w="full">
            <Button
              variant="outline"
              onClick={() => setImpersonateUser(null)}
              disabled={impersonating}
            >
              Cancel
            </Button>
            <Button
              colorPalette="brand"
              loading={impersonating}
              onClick={() => void handleConfirmImpersonate()}
            >
              Impersonate
            </Button>
          </Flex>
        </Dialog.Footer>
      </AppDialog>

      <AppDialog
        open={!!resetUser}
        onOpenChange={(details) => {
          if (!details.open && !resetting) {
            clearResetPasswordFields();
            setResetUser(null);
          }
        }}
        maxW="md"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>
            {resetUser ? `Reset password · ${resetUser.name}` : "Reset password"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" color="fg.muted" mb={3}>
            Reset the password for{" "}
            <Text as="span" fontWeight="medium" color="fg">
              {resetUser?.name}
            </Text>
            {resetUser?.email ? ` (${resetUser.email})` : ""}. They must change it
            on next login.
          </Text>
          <Checkbox.Root
            checked={resetSetPassword}
            onCheckedChange={(details) => {
              const next = !!details.checked;
              setResetSetPassword(next);
              if (!next) {
                setResetPassword("");
                setResetPasswordConfirm("");
              }
            }}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Text fontSize="sm" fontWeight="medium">
              Set password manually
            </Text>
          </Checkbox.Root>
          {resetSetPassword ? (
            <VStack align="stretch" gap={3} mt={3}>
              <Field.Root required>
                <Field.Label>New password</Field.Label>
                <Input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <PasswordStrengthMeter password={resetPassword} />
              </Field.Root>
              <Field.Root required>
                <Field.Label>Confirm password</Field.Label>
                <Input
                  type="password"
                  value={resetPasswordConfirm}
                  onChange={(e) => setResetPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </Field.Root>
            </VStack>
          ) : (
            <Text fontSize="sm" color="fg.muted" mt={3}>
              A strong temporary password will be generated. You can copy it or
              email it to them after generation.
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Flex gap={2} justify="flex-end" w="full">
            <Button
              variant="outline"
              onClick={() => {
                clearResetPasswordFields();
                setResetUser(null);
              }}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              colorPalette="brand"
              loading={resetting}
              onClick={() => void handleResetPassword()}
            >
              {resetSetPassword ? "Set temporary password" : "Generate temporary password"}
            </Button>
          </Flex>
        </Dialog.Footer>
      </AppDialog>

      <AppDialog
        open={!!tempReveal}
        onOpenChange={(details) => {
          if (!details.open) {
            setTempReveal(null);
            setCopiedTemp(false);
          }
        }}
        maxW="md"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>Temporary password</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" mb={2}>
            Share this password securely with{" "}
            <Text as="span" fontWeight="medium">
              {tempReveal?.name}
            </Text>
            . It will not be shown again.
          </Text>
          <Flex
            align="center"
            justify="center"
            gap={2}
            py={4}
            px={3}
            bg="gray.50"
            borderRadius="md"
          >
            <Box
              fontFamily="mono"
              fontSize="xl"
              fontWeight="bold"
              letterSpacing="0.12em"
              textAlign="center"
              wordBreak="break-all"
              flex="1"
            >
              {tempReveal?.password}
            </Box>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyTempPassword()}
              aria-label="Copy temporary password"
            >
              {copiedTemp ? <FiCheck /> : <FiCopy />}
              {copiedTemp ? "Copied" : "Copy"}
            </Button>
          </Flex>
          {tempReveal?.email ? (
            <Text fontSize="xs" color="fg.muted" mt={3}>
              Recipient email: {tempReveal.email}
            </Text>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Flex gap={2} justify="flex-end" w="full" wrap="wrap">
            <Button
              variant="outline"
              loading={emailingTemp}
              onClick={() => void emailTempPassword()}
              disabled={!tempReveal?.email}
            >
              <FiMail />
              Email to user
            </Button>
            <Button
              colorPalette="brand"
              onClick={() => {
                setTempReveal(null);
                setCopiedTemp(false);
              }}
            >
              Done
            </Button>
          </Flex>
        </Dialog.Footer>
      </AppDialog>
    </ListPageStack>
  );
}
