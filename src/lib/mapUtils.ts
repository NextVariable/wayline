import type { PlaceCategory, PlaceSource } from "../types/place";

export const categoryLabels: Record<PlaceCategory, string> = {
  food: "餐饮",
  business: "商务办公",
  university: "高校科研",
  transport: "交通枢纽",
  shopping: "购物商圈",
  attraction: "休闲景点",
  custom: "自定义",
};

export const sourceLabels: Record<PlaceSource, string> = {
  manual: "手动添加",
  imported: "文本导入",
  saved: "我的收藏",
  system: "城市资源",
};

export const categoryTone: Record<PlaceCategory, string> = {
  food: "#b77955",
  business: "#4f6f9f",
  university: "#5f8a68",
  transport: "#4f837f",
  shopping: "#a66b86",
  attraction: "#756b9f",
  custom: "#64748b",
};

export const categoryGlyph: Record<PlaceCategory, string> = {
  food: "🍽",
  business: "▦",
  university: "🎓",
  transport: "↗",
  shopping: "◼",
  attraction: "◎",
  custom: "◆",
};
