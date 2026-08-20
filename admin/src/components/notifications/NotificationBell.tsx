import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import {
  FiArrowRight,
  FiBell,
  FiCheckCircle,
  FiCheckSquare,
  FiInbox,
} from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { timeAgo, type UserNotification } from "../../lib/api";
import { useNotifications } from "./NotificationProvider";
import {
  renderFloatingMenuPortal,
  useFloatingMenuPosition,
  type FloatingMenuPlacement,
} from "../ui/floatingMenu";
import { SkeletonBlock } from "../ui/SkeletonBlock";

type Props = {
  compact?: boolean;
};

const PANEL_MAX_H = 460;
const GUTTER = 10;

function panelWidth() {
  if (typeof window === "undefined") return 380;
  return Math.min(380, window.innerWidth - GUTTER * 2);
}

function computeFlyout(trigger: DOMRect, compact: boolean): FloatingMenuPlacement {
  const width = panelWidth();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxHeight = Math.min(PANEL_MAX_H, vh - GUTTER * 2);

  if (compact) {
    const spaceBelow = vh - trigger.bottom - GUTTER;
    const openDown = spaceBelow >= 240;
    const available = openDown ? spaceBelow : Math.max(180, trigger.top - GUTTER);
    const height = Math.min(maxHeight, available);
    const left = Math.max(
      GUTTER,
      Math.min(trigger.right - width, vw - width - GUTTER)
    );
    if (openDown) {
      return {
        top: trigger.bottom + 8,
        left,
        width,
        maxHeight: height,
        placement: "bottom",
      };
    }
    return {
      top: Math.max(GUTTER, trigger.top - 8 - height),
      bottom: vh - trigger.top + 8,
      left,
      width,
      maxHeight: height,
      placement: "top",
    };
  }

  let left = trigger.right + 12;
  if (left + width > vw - GUTTER) {
    left = Math.max(GUTTER, trigger.left - width - 12);
  }
  return {
    top: Math.max(GUTTER, trigger.bottom - maxHeight),
    bottom: Math.max(GUTTER, vh - trigger.bottom),
    left,
    width,
    maxHeight,
    placement: "top",
  };
}

function typeMeta(type: string) {
  if (type === "action_completed") {
    return {
      icon: FiCheckCircle,
      bg: "green.50",
      color: "green.600",
      label: "Completed",
    };
  }
  if (type === "action_assigned") {
    return {
      icon: FiCheckSquare,
      bg: "brand.50",
      color: "brand.700",
      label: "Assigned",
    };
  }
  return { icon: FiBell, bg: "gray.100", color: "gray.600", label: "Update" };
}

function dayBucket(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startThat) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return "Earlier";
}

function groupNotifications(items: UserNotification[]) {
  const groups: { label: string; items: UserNotification[] }[] = [];
  for (const item of items) {
    const label = dayBucket(item.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function NotificationBell({ compact = false }: Props) {
  const { unreadCount, notifications, loading, markRead, markAllRead, refresh } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const placementTick = useFloatingMenuPosition(open, triggerRef, PANEL_MAX_H);
  const navigate = useNavigate();

  const flyout = useMemo(() => {
    if (!open || !placementTick || !triggerRef.current) return null;
    return computeFlyout(triggerRef.current.getBoundingClientRect(), compact);
  }, [open, placementTick, compact]);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();
    function onDoc(event: PointerEvent) {
      const path = event.composedPath();
      if (triggerRef.current && path.includes(triggerRef.current)) return;
      const panel = document.getElementById("notification-panel");
      if (panel && path.includes(panel)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refresh]);

  async function openItem(id: number | null, notificationId: number) {
    await markRead([notificationId]);
    setOpen(false);
    if (id) navigate(`/reminders?id=${id}`);
    else navigate("/reminders");
  }

  function openReminders() {
    setOpen(false);
    navigate("/reminders");
  }

  const groups = useMemo(() => groupNotifications(notifications), [notifications]);
  const showSkeletons = loading && !notifications.length;

  return (
    <>
      <Box ref={triggerRef} position="relative" display="inline-flex">
        <Box
          as="button"
          aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
          aria-expanded={open}
          aria-haspopup="dialog"
          w={compact ? "40px" : "34px"}
          h={compact ? "40px" : "34px"}
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="full"
          borderWidth={compact ? "0px" : "1px"}
          borderColor={open || unreadCount ? "brand.200" : "border"}
          bg={
            open || unreadCount
              ? "brand.50"
              : compact
                ? "gray.100"
                : "white"
          }
          color={unreadCount || open ? "brand.700" : compact ? "gray.700" : "fg.muted"}
          boxShadow={compact ? "none" : "sm"}
          cursor="pointer"
          transition="background 0.15s ease, border-color 0.15s ease, color 0.15s ease"
          _hover={{
            bg: unreadCount || open ? "brand.100" : compact ? "gray.200" : "brand.50",
            color: unreadCount || open ? "brand.700" : compact ? "gray.800" : "brand.700",
            borderColor: "brand.200",
          }}
          onClick={() => setOpen((value) => !value)}
        >
          <FiBell size={16} />
        </Box>
        {unreadCount > 0 ? (
          <Flex
            position="absolute"
            top="-3px"
            right="-3px"
            minW="16px"
            h="16px"
            px="3px"
            align="center"
            justify="center"
            bg="red.500"
            color="white"
            borderRadius="full"
            fontSize="9px"
            fontWeight="bold"
            lineHeight="1"
            borderWidth="2px"
            borderColor="white"
            zIndex={1}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
            <Box
              position="absolute"
              inset="-2px"
              borderRadius="full"
              bg="red.400"
              zIndex={-1}
              css={{
                animation: "notify-ping 1.6s ease-out infinite",
                "@keyframes notify-ping": {
                  "0%": { transform: "scale(1)", opacity: 0.55 },
                  "100%": { transform: "scale(1.85)", opacity: 0 },
                },
              }}
            />
          </Flex>
        ) : null}
      </Box>
      {open
        ? renderFloatingMenuPortal(
            flyout,
            <Box
              id="notification-panel"
              role="dialog"
              aria-label="Notifications"
              w="full"
              h={`${flyout?.maxHeight || PANEL_MAX_H}px`}
              display="flex"
              flexDirection="column"
              overflow="hidden"
              bg="bg.panel"
              borderWidth="1px"
              borderColor="blackAlpha.100"
              borderRadius="2xl"
              boxShadow="0 18px 50px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.06)"
            >
              <Flex
                px={4}
                py={3}
                align="center"
                justify="space-between"
                gap={3}
                borderBottomWidth="1px"
                borderColor="border.muted"
                flexShrink={0}
              >
                <Box minW={0}>
                  <Text fontSize="sm" fontWeight="semibold" letterSpacing="-0.02em">
                    Notifications
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {unreadCount
                      ? `${unreadCount} unread`
                      : notifications.length
                        ? "You're up to date"
                        : "Reminders and mentions"}
                  </Text>
                </Box>
                {unreadCount > 0 ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    color="brand.700"
                    fontWeight="medium"
                    onClick={() => void markAllRead()}
                  >
                    Mark all read
                  </Button>
                ) : null}
              </Flex>

              <Box flex="1" minH={0} overflowY="auto">
                {showSkeletons ? (
                  <Flex direction="column" gap={3} px={4} py={4}>
                    {[0, 1, 2].map((key) => (
                      <Flex key={key} gap={3} align="flex-start">
                        <SkeletonBlock boxSize="36px" borderRadius="full" />
                        <Box flex="1">
                          <SkeletonBlock height="12px" width="70%" mb={2} />
                          <SkeletonBlock height="10px" width="92%" />
                        </Box>
                      </Flex>
                    ))}
                  </Flex>
                ) : !notifications.length ? (
                  <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    h="full"
                    px={6}
                    textAlign="center"
                  >
                    <Flex
                      w="52px"
                      h="52px"
                      align="center"
                      justify="center"
                      borderRadius="full"
                      bg="brand.50"
                      color="brand.600"
                      mb={3}
                    >
                      <FiInbox size={22} />
                    </Flex>
                    <Text fontSize="sm" fontWeight="semibold">
                      You're all caught up
                    </Text>
                    <Text fontSize="xs" color="fg.muted" mt={1} maxW="220px">
                      Assigned reminders and completed tasks will land here.
                    </Text>
                  </Flex>
                ) : (
                  groups.map((group) => (
                    <Box key={group.label} py={1}>
                      <Text
                        px={4}
                        pt={3}
                        pb={1}
                        fontSize="11px"
                        fontWeight="semibold"
                        color="fg.subtle"
                        letterSpacing="0.04em"
                        textTransform="uppercase"
                      >
                        {group.label}
                      </Text>
                      {group.items.map((item) => {
                        const meta = typeMeta(item.type);
                        const Icon = meta.icon;
                        return (
                          <Flex
                            key={item.id}
                            as="button"
                            w="full"
                            textAlign="left"
                            align="flex-start"
                            gap={3}
                            px={4}
                            py={2.5}
                            bg={item.isRead ? "transparent" : "brand.50"}
                            borderLeftWidth="2px"
                            borderLeftColor={item.isRead ? "transparent" : "brand.500"}
                            cursor="pointer"
                            transition="background 0.12s ease"
                            _hover={{ bg: item.isRead ? "bg.muted" : "brand.100" }}
                            onClick={() => void openItem(item.actionItemId, item.id)}
                          >
                            <Flex
                              w="36px"
                              h="36px"
                              flexShrink={0}
                              align="center"
                              justify="center"
                              borderRadius="full"
                              bg={item.isRead ? meta.bg : "white"}
                              color={meta.color}
                              borderWidth="1px"
                              borderColor={item.isRead ? "transparent" : "brand.100"}
                            >
                              <Icon size={16} />
                            </Flex>
                            <Box minW={0} flex="1">
                              <Flex align="center" justify="space-between" gap={2}>
                                <Text
                                  fontSize="sm"
                                  fontWeight={item.isRead ? "medium" : "semibold"}
                                  lineClamp={1}
                                >
                                  {item.title}
                                </Text>
                                {!item.isRead ? (
                                  <Box
                                    w="7px"
                                    h="7px"
                                    borderRadius="full"
                                    bg="brand.500"
                                    flexShrink={0}
                                  />
                                ) : null}
                              </Flex>
                              {item.body ? (
                                <Text fontSize="xs" color="fg.muted" lineClamp={2} mt="2px">
                                  {item.body}
                                </Text>
                              ) : null}
                              <Text fontSize="11px" color="fg.subtle" mt={1}>
                                {meta.label} · {timeAgo(item.createdAt)}
                              </Text>
                            </Box>
                          </Flex>
                        );
                      })}
                    </Box>
                  ))
                )}
              </Box>

              <Flex
                as="button"
                align="center"
                justify="space-between"
                px={4}
                py={3}
                borderTopWidth="1px"
                borderColor="border.muted"
                bg="bg"
                color="brand.700"
                fontSize="sm"
                fontWeight="medium"
                cursor="pointer"
                flexShrink={0}
                _hover={{ bg: "brand.50" }}
                onClick={openReminders}
              >
                View all reminders
                <FiArrowRight size={14} />
              </Flex>
            </Box>
          )
        : null}
    </>
  );
}
