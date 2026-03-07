declare module "renderjson" {
  interface RenderJSON {
    (json: unknown): HTMLPreElement;
    set_icons(show: string, hide: string): RenderJSON;
    set_show_to_level(level: number | "all"): RenderJSON;
    set_max_string_length(length: number | "none"): RenderJSON;
    set_sort_objects(sort: boolean): RenderJSON;
    set_replacer(replacer: ((key: string, value: unknown) => unknown) | undefined): RenderJSON;
    set_collapse_msg(fn: (count: number) => string): RenderJSON;
    set_property_list(list: string[] | undefined): RenderJSON;
    set_show_by_default(show: boolean): RenderJSON;
    options: Record<string, unknown>;
  }
  const renderjson: RenderJSON;
  export default renderjson;
  export = renderjson;
}
