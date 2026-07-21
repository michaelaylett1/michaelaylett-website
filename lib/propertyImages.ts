export type PropertyImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * Real photos from Michael's owned and operated portfolio.
 * Dimensions match the optimized files in /public/images/properties
 * so next/image can render without layout shift.
 */
export const propertyImages = {
  entrywayStaircase: {
    src: "/images/properties/entryway-staircase.jpg",
    alt: "Bright entryway and staircase with wood flooring inside a renovated co-living home, with a numbered bedroom door visible in the background",
    width: 2400,
    height: 1600,
  },
  hallwayNumberedDoors: {
    src: "/images/properties/hallway-numbered-doors.jpg",
    alt: "Upstairs hallway with numbered bedroom doors, black stair railing, and wood-look flooring in a professionally managed co-living property",
    width: 2400,
    height: 1600,
  },
  aerialNeighborhood: {
    src: "/images/properties/aerial-neighborhood-atlanta.jpg",
    alt: "Aerial view of a wooded suburban Atlanta neighborhood with single-family homes and the downtown Atlanta skyline visible in the distance",
    width: 2000,
    height: 1500,
  },
  kitchenRenovated: {
    src: "/images/properties/kitchen-renovated.jpg",
    alt: "Renovated kitchen with gray shaker cabinets, stainless steel appliances, quartz countertops, and a gold faucet",
    width: 2400,
    height: 1600,
  },
  bathroomRenovated: {
    src: "/images/properties/bathroom-renovated.jpg",
    alt: "Renovated bathroom with a marble-tiled walk-in glass shower, built-in bench, and a white vanity with matte black fixtures",
    width: 2400,
    height: 1600,
  },
  kitchenWhiteRenovated: {
    src: "/images/properties/kitchen-white-renovated.webp",
    alt: "Renovated kitchen with white shaker cabinets, a center island, stainless steel appliances, and quartz countertops",
    width: 2048,
    height: 1365,
  },
  aerialDallas: {
    src: "/images/properties/aerial-dallas-texas.webp",
    alt: "Aerial view of a tree-lined residential neighborhood in Dallas, Texas with single-family homes along a main road",
    width: 1800,
    height: 1350,
  },
  diningFireplace: {
    src: "/images/properties/dining-fireplace-common-area.webp",
    alt: "Shared dining area with a wood dining table, a lit brick fireplace, and built-in white shelving",
    width: 2048,
    height: 1365,
  },
  kitchenClassicMaintained: {
    src: "/images/properties/kitchen-classic-maintained.webp",
    alt: "Well-maintained kitchen with wood cabinetry, granite countertops, and a tiled backsplash in a professionally managed property",
    width: 2048,
    height: 1365,
  },
} satisfies Record<string, PropertyImage>;

/**
 * Michael's professional headshot, used on the About page.
 */
export const profileImage: PropertyImage = {
  src: "/images/profile/michael-aylett-profile.webp",
  alt: "Michael Aylett, real estate investor and owner-operator",
  width: 1000,
  height: 1250,
};
