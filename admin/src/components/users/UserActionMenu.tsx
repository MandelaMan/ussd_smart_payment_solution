import { Box, IconButton, Menu, Portal } from "@chakra-ui/react";
import {
  FiCheck,
  FiEdit3,
  FiEye,
  FiKey,
  FiMoreVertical,
  FiShield,
  FiSlash,
  FiUserCheck,
} from "react-icons/fi";
import type { AdminUser } from "../../lib/api";
import { FLOATING_MENU_Z_INDEX } from "../ui/floatingMenu";

export const USER_ROLE_OPTIONS = [
  { value: "admin", label: "Administrator" },
  { value: "user", label: "User" },
] as const;

export type UserAction =
  | { type: "editName" }
  | { type: "editUser" }
  | { type: "permissions" }
  | { type: "impersonate" }
  | { type: "role"; role: string }
  | { type: "resetPassword" }
  | { type: "toggleActive" };

type Props = {
  user: AdminUser;
  onAction: (action: UserAction) => void;
  isProtectedAdmin?: boolean;
  showImpersonate?: boolean;
  impersonateDisabledReason?: string | null;
};

export function UserActionMenu({
  user,
  onAction,
  isProtectedAdmin,
  showImpersonate,
  impersonateDisabledReason,
}: Props) {
  const currentRole = user.role === "admin" ? "admin" : "user";

  return (
    <Menu.Root
      positioning={{ placement: "bottom-end" }}
      onSelect={(details) => {
        const value = details.value;
        window.setTimeout(() => {
          if (value === "editName") {
            onAction({ type: "editName" });
            return;
          }
          if (value === "editUser") {
            onAction({ type: "editUser" });
            return;
          }
          if (value === "permissions") {
            onAction({ type: "permissions" });
            return;
          }
          if (value === "impersonate") {
            onAction({ type: "impersonate" });
            return;
          }
          if (value.startsWith("role:")) {
            const role = value.slice(5);
            if (role !== currentRole) onAction({ type: "role", role });
            return;
          }
          if (value === "resetPassword") onAction({ type: "resetPassword" });
          if (value === "toggleActive") onAction({ type: "toggleActive" });
        }, 150);
      }}
    >
      <Menu.Trigger asChild>
        <IconButton
          aria-label={`Actions for ${user.name}`}
          variant="ghost"
          size="sm"
          color="fg.muted"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <FiMoreVertical />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex={FLOATING_MENU_Z_INDEX}>
          <Menu.Content
            minW="200px"
            borderRadius="lg"
            boxShadow="lg"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            py={1}
            zIndex={FLOATING_MENU_Z_INDEX}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Menu.Item value="editUser">
              <FiEdit3 />
              Edit user
            </Menu.Item>
            <Menu.Item value="permissions">
              <FiShield />
              Permissions
            </Menu.Item>
            {showImpersonate ? (
              <Menu.Item
                value="impersonate"
                disabled={Boolean(impersonateDisabledReason)}
                title={impersonateDisabledReason || undefined}
              >
                <FiEye />
                Impersonate
              </Menu.Item>
            ) : null}
            <Menu.Separator />
            <Menu.ItemGroup>
              <Menu.ItemGroupLabel fontSize="xs" color="fg.muted" px={3} py={1}>
                System role
              </Menu.ItemGroupLabel>
              {USER_ROLE_OPTIONS.map((opt) => (
                <Menu.Item key={opt.value} value={`role:${opt.value}`}>
                  {opt.value === currentRole ? (
                    <FiCheck />
                  ) : (
                    <Box as="span" w="14px" flexShrink={0} />
                  )}
                  {opt.label}
                </Menu.Item>
              ))}
            </Menu.ItemGroup>
            <Menu.Separator />
            <Menu.Item value="resetPassword">
              <FiKey />
              Reset password
            </Menu.Item>
            <Menu.Item
              value="toggleActive"
              disabled={isProtectedAdmin}
              title={
                isProtectedAdmin
                  ? "Administrator accounts cannot be deactivated"
                  : undefined
              }
            >
              {user.is_active ? <FiSlash /> : <FiUserCheck />}
              {user.is_active ? "Disable" : "Activate"}
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
