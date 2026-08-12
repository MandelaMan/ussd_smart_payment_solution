import { IconButton, Menu, Portal } from "@chakra-ui/react";
import {
  FiEdit2,
  FiMoreVertical,
  FiPauseCircle,
  FiPlayCircle,
  FiTrash2,
} from "react-icons/fi";
import type { Campaign } from "../../lib/api";
import { FLOATING_MENU_Z_INDEX } from "../ui/floatingMenu";

export type CampaignAction = "edit" | "pause" | "resume" | "delete";

type Props = {
  campaign: Campaign;
  onAction: (campaign: Campaign, action: CampaignAction) => void;
};

export function CampaignActionMenu({ campaign, onAction }: Props) {
  const canPause = campaign.status === "active";
  const canResume = campaign.status === "paused";

  return (
    <Menu.Root
      positioning={{ placement: "bottom-end" }}
      onSelect={(details) => {
        const action = details.value as CampaignAction;
        window.setTimeout(() => onAction(campaign, action), 150);
      }}
    >
      <Menu.Trigger asChild>
        <IconButton
          aria-label="Campaign actions"
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
            minW="180px"
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
              Edit
            </Menu.Item>
            {canPause ? (
              <Menu.Item value="pause">
                <FiPauseCircle />
                Pause
              </Menu.Item>
            ) : null}
            {canResume ? (
              <Menu.Item value="resume">
                <FiPlayCircle />
                Resume
              </Menu.Item>
            ) : null}
            <Menu.Item value="delete" color="fg.error">
              <FiTrash2 />
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
