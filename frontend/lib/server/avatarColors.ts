const AVATAR_COLORS = [
  "#E53E3E", "#DD6B20", "#D69E2E", "#38A169", "#319795",
  "#3182CE", "#5A67D8", "#805AD5", "#D53F8C", "#B83280",
];

export function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}
