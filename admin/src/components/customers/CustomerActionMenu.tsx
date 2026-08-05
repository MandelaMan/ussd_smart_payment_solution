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
  FiWifiOff,
  FiPauseCircle,
  FiXCircle,
} from "react-icons/fi";
import type { Customer } from "../../lib/api";
import { FLOATING_MENU_Z_INDEX } from "../ui/floatingMenu";

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
  | "deletePermanent";

type Props = {
  customer: Customer;
  onAction: (customer: Customer, action: CustomerAction) => void;
  allowPermanentDelete?: boolean;
};

export function CustomerActionMenu({ customer, onAction, allowPermanentDelete }: Props) {
  const active = customer.status === "active";

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
                  Move apartment
                </Menu.Item>
                <Menu.Item value="convertType">
                  <FiRepeat />
                  {customer.customerType === "C2B" ? "Convert to B2B" : "Convert to C2B"}
                </Menu.Item>
                <Menu.Separator />
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
                  Cancel subscription
                </Menu.Item>
              </>
            )}
            <Menu.Separator />
            <Menu.Item value="history">
              <FiClock />
              Apartment history
            </Menu.Item>
            {allowPermanentDelete ? (
              <>
                <Menu.Separator />
                <Menu.Item value="deletePermanent" color="fg.error">
                  <FiTrash2 />
                  Delete customer permanently
                </Menu.Item>
              </>
            ) : null}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
