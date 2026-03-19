export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  /** Pre-filled auth token (only sent when dangerouslyDisableDeviceAuth is enabled). */
  authToken?: string;
};
