// A grouped transaction can contain a directed protocol action alongside a
// shared-input transfer. Keep the card's cautious label, but expose each action
// when filtering the timeline.
export function notificationMatchesDirection(item, filter) {
  if (filter === "all") return true;
  if (filter !== "incoming" && filter !== "outgoing") return false;
  const matches = direction => direction === filter || direction === "self" || (filter === "incoming" && direction === "related");
  return matches(item.direction) || (item.actions ?? []).some(action => matches(action.direction));
}
