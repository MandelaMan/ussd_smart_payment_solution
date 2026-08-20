import { IconButton, Menu, Portal } from "@chakra-ui/react";
import {
  FiArrowDown,
  FiArrowUp,
  FiCalendar,
  FiClock,
  FiEdit2,
  FiMoreVertical,
  FiMove,
  FiRepeat,
  FiTrash2,
  FiWifi,
  FiWifiOff,
  FiPauseCircle,
  FiXCircle,
  FiCheckSquare,
} from "react-icons/fi";
import type { Customer } from "../../lib/api";
import { isShopPremise } from "../../lib/premise";
import { FLOATING_MENU_Z_INDEX } from "../ui/floatingMenu";
import { useAuth } from "../../lib/authContext";
import { hasPermission } from "../../lib/rbac";
import { canCreateCustomerOnTisp } from "../../lib/customerStatus";

export type CustomerAction =
  | "edit"
  | "upgrade"
  | "downgrade"
  | "changePaymentFrequency"
  | "switch"
  | "disconnect"
  | "pause"
  | "cancel"
  | "history"
  | "convertType"
  | "deletePermanent"
  | "createReminder"
  | "createOnTisp";

type Props = {
  customer: Customer;
  onAction: (customer: Customer, action: CustomerAction) => void;
  allowPermanentDelete?: boolean;
};

export function CustomerActionMenu({ customer, onAction, allowPermanentDelete }: Props) {
  const { user } = useAuth();
  const canCreateReminder = hasPermission(user, "action_items.create");
  const active = customer.status === "active";
  const cancelled = customer.status === "cancelled";
  // Permanent delete is a local wipe only — only after cancel so integrations are stopped.
  const showPermanentDelete = Boolean(allowPermanentDelete) && cancelled;

  return (
    <Menu.Root
      positioning={{ placement: "bottom-end" }}
      onSelect={(details) => {
        const action = details.value as CustomerAction;
        window.setTimeout(() => onAction(customer, action), 150);
      }}
    >
      <Menu.Trigger asChild>
        <IconButton
          aria-label="Customer actions"
          variant="outline"
          size="sm"
          borderRadius="md"
          bg="bg.panel"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <FiMoreVertical />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex={FLOATING_MENU_Z_INDEX}>
          <Menu.Content
            minW="220px"
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
            <Menu.Item value="edit">
              <FiEdit2 />
              Edit customer details
            </Menu.Item>
            {canCreateReminder ? (
              <Menu.Item value="createReminder">
                <FiCheckSquare />
                Create reminder
              </Menu.Item>
            ) : null}
            {active && (
              <>
                <Menu.Separator />
                <Menu.Item value="upgrade">
                  <FiArrowUp />
                  Upgrade package
                </Menu.Item>
                <Menu.Item value="downgrade">
                  <FiArrowDown />
                  Downgrade package
                </Menu.Item>
                <Menu.Item value="changePaymentFrequency">
                  <FiCalendar />
                  Update frequency
                </Menu.Item>
                <Menu.Item value="switch">
                  <FiMove />
                  {isShopPremise(customer) ? "Move unit" : "Move apartment"}
                </Menu.Item>
                <Menu.Item value="convertType">
                  <FiRepeat />
                  {customer.customerType === "C2B" ? "Convert to B2B" : "Convert to C2B"}
                </Menu.Item>
                <Menu.Separator />
                {canCreateCustomerOnTisp(customer) ? (
                  <Menu.Item value="createOnTisp">
                    <FiWifi />
                    Create on TISP
                  </Menu.Item>
                ) : null}
                <Menu.Item value="pause">
                  <FiPauseCircle />
                  Pause service (away)
                </Menu.Item>
                <Menu.Item value="disconnect" color="fg.error">
                  <FiWifiOff />
                  Suspend on TISP
                </Menu.Item>
                <Menu.Item value="cancel" color="fg.error">
                  <FiXCircle />
                  {isShopPremise(customer) ? "Cancel & release shop" : "Cancel & release apartment"}
                </Menu.Item>
              </>
            )}
            <Menu.Separator />
            <Menu.Item value="history">
              <FiClock />
              {isShopPremise(customer) ? "Occupancy history" : "Apartment history"}
            </Menu.Item>
            {showPermanentDelete ? (
              <>
                <Menu.Separator />
                <Menu.Item value="deletePermanent" color="fg.error">
                  <FiTrash2 />
                  Wipe local records
                </Menu.Item>
              </>
            ) : null}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
