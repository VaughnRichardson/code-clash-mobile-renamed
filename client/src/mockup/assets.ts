export const MOCKUP_ASSETS = {
  scenes: {
    home: '/art/scenes/home.jpg',
    table: '/art/scenes/table.jpg',
    result: '/art/scenes/result.jpg',
  },
  cards: (id: string) => `/art/cards/${id.toLowerCase()}.png`,
  leaders: (id: string) => `/art/leaders/${id.toLowerCase()}.jpg`,
} as const
