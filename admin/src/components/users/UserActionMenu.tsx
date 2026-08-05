import { Box, IconButton, Menu, Portal } from "@chakra-ui/react";
import {
  FiCheck,
  FiEdit3,
  FiKey,
  FiMoreVertical,
  FiSlash,
  FiUserCheck,
} from "react-icons/fi";
import type { AdminUser } from "../../lib/api";
import { FLOATING_MENU_Z_INDEX } from "../ui/floatingMenu";

export const USER_ROLE_OPTIONS = [
  { value: "admin", label: "Administrator" },
  { value: "support", label: "Customer Support" },
  { value: "cfo", label: "CFO" },
  { value: "ceo", label: "CEO" },
  { value: "partner", label: "Partner" },
] as const;

export type UserAction =
  | { type: "editName" }
  | { type: "role"; role: string }
  | { type: "resetPassword" }
  | { type: "toggleActive" };

type Props = {
  user: AdminUser;
  onAction: (action: UserAction) => void;
  isProtectedAdmin?: boolean;
};

export function UserActionMenu({ user, onAction, isProtectedAdmin }: Props) {
  const currentRole = user.role === "viewer" ? "support" : user.role;

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
            <Menu.Item value="editName">
              <FiEdit3 />
              Edit name
            </Menu.Item>
            <Menu.Separator />
            <Menu.ItemGroup>
              <Menu.ItemGroupLabel fontSize="xs" color="fg.muted" px={3} py={1}>
                Role
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
              {user.is_active ? "Deactivate" : "Activate"}
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
