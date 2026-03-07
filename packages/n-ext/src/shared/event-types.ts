export interface NExtEvent {
  id: string;
  cursor: number;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  statusText: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  responseSize: number | null;
  duration: number;
  timestamp: number;
  error: string | null;
  source: "fetch" | "http";
}

export interface SeeResponse {
  cursor: number;
  events: NExtEvent[];
}
