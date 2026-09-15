export type ToastLevel = "success" | "error" | "info";

export type ToastMessage = {
  id: number;
  text: string;
  level: ToastLevel;
};

export type ConnectionState = "connecting" | "open" | "closed";
