import type { AppStatusState } from "../../shared/components/AppStatusRow";

export type ComputerWorkspaceStatus = AppStatusState & {
  presentation?: "entry" | "connection-required";
};

export function computerShellStatus(input: {
  workspace: string;
  status: ComputerWorkspaceStatus;
  connected: boolean;
  secondaryStatus?: AppStatusState;
}): { primary: AppStatusState; secondary?: AppStatusState } | undefined;
