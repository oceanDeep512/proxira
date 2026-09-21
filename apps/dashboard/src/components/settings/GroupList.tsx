import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { cn } from "../../lib/cn";

export type GroupListItem = {
  id: string;
  name: string;
  /** 次要说明（规则条数、是否停用等），显示在名称下方。 */
  meta?: ReactNode;
};

/**
 * 设置面板里的分组列表（请求头分组 / Mock 分组共用）。
 *
 * 只画「壳」：行里的内容由调用方拼好传进来，删除确认也在这里内联完成 ——
 * 再套一个 ConfirmDialog 会让层级和焦点管理都变复杂，而这里删的是一个分组，
 * 二次确认只需一次点击。
 *
 * 顺序是**有意义的**：请求头分组按列表顺序叠加（后面的覆盖前面的），
 * Mock 分组按顺序匹配（先命中者返回）。所以列表自带上移/下移，
 * 而不是让用户在别处猜顺序。
 *
 * 行里**只放导航**（选中/排序/删除），不放任何改配置的开关：这里放一个
 * 「整组启用」的开关，右边编辑区再放一个，两处控件对同一个状态却有两套保存
 * 语义（一个立即生效、一个要按保存），必然出乱子。状态用文字说明就够了。
 *
 * 列宽按「最长的内容也得活下来」定：名称 + 一行 meta，右边留三个图标的宽度。
 * 窄了就会出现「订单…」这种被截断的名字，比没排序按钮还难用。
 */
export const GroupList = ({
  title,
  items,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onMove,
  emptyHint,
}: {
  title: string;
  items: GroupListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  emptyHint: string;
}) => {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="px-title-eyebrow">{title}</span>
        <span className="font-mono text-[11px] text-fg-dim">{items.length}</span>
      </div>

      <Button variant="secondary" size="sm" onClick={onCreate} className="w-full">
        <Plus className="size-3.5" />
        新建分组
      </Button>

      {items.length === 0 ? (
        <p className="m-0 rounded-md border border-dashed border-line px-3 py-3 text-[12px] leading-relaxed text-fg-dim">
          {emptyHint}
        </p>
      ) : (
        <ul className="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-0">
          {items.map((item, index) => {
            const active = item.id === selectedId;
            const confirming = confirmId === item.id;
            return (
              <li key={item.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-md border px-2 py-1.5 transition-colors",
                    active
                      ? "border-accent/50 bg-accent-soft"
                      : "border-transparent hover:bg-surface-2",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={active}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                  >
                    <span
                      className={cn(
                        "max-w-full truncate text-[13px] font-medium",
                        active ? "text-accent-strong" : "text-fg",
                      )}
                    >
                      {item.name}
                    </span>
                    {item.meta ? (
                      <span className="text-[11px] leading-tight text-fg-dim">{item.meta}</span>
                    ) : null}
                  </button>

                  {/* 顺序与删除只在 hover/聚焦时出现：列表本身很窄，
                      常驻三个图标会把分组名挤没。 */}
                  <div
                    className={cn(
                      "flex shrink-0 items-center gap-0.5",
                      "opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100",
                      active && "opacity-100",
                    )}
                  >
                    {confirming ? (
                      <>
                        <IconButton
                          label={`确认删除分组 ${item.name}`}
                          tone="danger"
                          className="size-6 border-danger/50 text-danger [&_svg]:size-3"
                          onClick={() => {
                            onDelete(item.id);
                            setConfirmId(null);
                          }}
                        >
                          <Trash2 />
                        </IconButton>
                        <IconButton
                          label="取消删除"
                          className="size-6 [&_svg]:size-3"
                          onClick={() => setConfirmId(null)}
                        >
                          <Plus className="rotate-45" />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton
                          label="上移（更早生效）"
                          className="size-6 [&_svg]:size-3"
                          disabled={index === 0}
                          onClick={() => onMove(item.id, "up")}
                        >
                          <ArrowUp />
                        </IconButton>
                        <IconButton
                          label="下移（更晚生效）"
                          className="size-6 [&_svg]:size-3"
                          disabled={index === items.length - 1}
                          onClick={() => onMove(item.id, "down")}
                        >
                          <ArrowDown />
                        </IconButton>
                        <IconButton
                          label={`删除分组 ${item.name}`}
                          tone="danger"
                          className="size-6 [&_svg]:size-3"
                          onClick={() => setConfirmId(item.id)}
                        >
                          <Trash2 />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
