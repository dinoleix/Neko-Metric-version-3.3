import type { InventoryBucket } from '../types';

export interface AugustStockImportRow {
  name: string;
  sourceUnit: string;
  unitCost: number;
  b6Quantity: number;
  b6Total: number;
  sdjQuantity: number;
  sdjTotal: number;
  bucket: InventoryBucket;
}

// Closing count for August 2026, transcribed from the approved stock sheet.
export const AUGUST_2026_STOCK_IMPORT: AugustStockImportRow[] = [
  {
    "name": "thigh w skin",
    "sourceUnit": "kg",
    "unitCost": 320,
    "b6Quantity": 4,
    "b6Total": 1280,
    "sdjQuantity": 2.9,
    "sdjTotal": 928,
    "bucket": "FOOD"
  },
  {
    "name": "breast",
    "sourceUnit": "kg",
    "unitCost": 260,
    "b6Quantity": 3,
    "b6Total": 780,
    "sdjQuantity": 2,
    "sdjTotal": 520,
    "bucket": "FOOD"
  },
  {
    "name": "thigh w/o skin",
    "sourceUnit": "kg",
    "unitCost": 320,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "feet",
    "sourceUnit": "kg",
    "unitCost": 160,
    "b6Quantity": 1.3,
    "b6Total": 208,
    "sdjQuantity": 1.5,
    "sdjTotal": 240,
    "bucket": "FOOD"
  },
  {
    "name": "chicken skin",
    "sourceUnit": "kg",
    "unitCost": 150,
    "b6Quantity": 4,
    "b6Total": 600,
    "sdjQuantity": 2.8,
    "sdjTotal": 420,
    "bucket": "FOOD"
  },
  {
    "name": "wings",
    "sourceUnit": "kg",
    "unitCost": 300,
    "b6Quantity": 5,
    "b6Total": 1500,
    "sdjQuantity": 7.5,
    "sdjTotal": 2250,
    "bucket": "FOOD"
  },
  {
    "name": "shrimp",
    "sourceUnit": "kg",
    "unitCost": 700,
    "b6Quantity": 0.653,
    "b6Total": 457.1,
    "sdjQuantity": 2,
    "sdjTotal": 1400,
    "bucket": "FOOD"
  },
  {
    "name": "octopus",
    "sourceUnit": "kg",
    "unitCost": 550,
    "b6Quantity": 3.3,
    "b6Total": 1815,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "salmon",
    "sourceUnit": "kg",
    "unitCost": 1563.5,
    "b6Quantity": 0.6,
    "b6Total": 938.0999999999999,
    "sdjQuantity": 1,
    "sdjTotal": 1563.5,
    "bucket": "FOOD"
  },
  {
    "name": "tuna",
    "sourceUnit": "kg",
    "unitCost": 1000,
    "b6Quantity": 1,
    "b6Total": 1000,
    "sdjQuantity": 1.2,
    "sdjTotal": 1200,
    "bucket": "FOOD"
  },
  {
    "name": "chicken bones",
    "sourceUnit": "kg",
    "unitCost": 130,
    "b6Quantity": 3,
    "b6Total": 390,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Lp sauce",
    "sourceUnit": "litre",
    "unitCost": 655.17,
    "b6Quantity": 0.2,
    "b6Total": 131.034,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "cooking sake",
    "sourceUnit": "litre",
    "unitCost": 722,
    "b6Quantity": 1,
    "b6Total": 722,
    "sdjQuantity": 0.58,
    "sdjTotal": 418.76,
    "bucket": "FOOD"
  },
  {
    "name": "sriracha real thai",
    "sourceUnit": "litre",
    "unitCost": 600,
    "b6Quantity": 0.7,
    "b6Total": 420,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "sesame oil",
    "sourceUnit": "litre",
    "unitCost": 600.6,
    "b6Quantity": 0.5,
    "b6Total": 300.3,
    "sdjQuantity": 0.4,
    "sdjTotal": 240.24,
    "bucket": "FOOD"
  },
  {
    "name": "leekumki dark soya",
    "sourceUnit": "litre",
    "unitCost": 480,
    "b6Quantity": 0.5,
    "b6Total": 240,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "rice vineger",
    "sourceUnit": "litre",
    "unitCost": 211.29,
    "b6Quantity": 0.13,
    "b6Total": 27.4677,
    "sdjQuantity": 1.25,
    "sdjTotal": 264.1125,
    "bucket": "FOOD"
  },
  {
    "name": "evaporated milk",
    "sourceUnit": "ml",
    "unitCost": 240,
    "b6Quantity": 0.4,
    "b6Total": 96,
    "sdjQuantity": 1.137,
    "sdjTotal": 272.88,
    "bucket": "FOOD"
  },
  {
    "name": "hon mirin",
    "sourceUnit": "litre",
    "unitCost": 321.11,
    "b6Quantity": 1.4,
    "b6Total": 449.554,
    "sdjQuantity": 1.4,
    "sdjTotal": 449.554,
    "bucket": "FOOD"
  },
  {
    "name": "tabasco",
    "sourceUnit": "60ml",
    "unitCost": 269,
    "b6Quantity": 6,
    "b6Total": 1614,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "eggless mayo",
    "sourceUnit": "kg",
    "unitCost": 214.29,
    "b6Quantity": 1,
    "b6Total": 214.29,
    "sdjQuantity": 2,
    "sdjTotal": 428.58,
    "bucket": "FOOD"
  },
  {
    "name": "vanilla essence",
    "sourceUnit": "10ml",
    "unitCost": 39,
    "b6Quantity": 1.8,
    "b6Total": 70.2,
    "sdjQuantity": 0.85,
    "sdjTotal": 33.15,
    "bucket": "FOOD"
  },
  {
    "name": "kewpie mayo",
    "sourceUnit": "litre",
    "unitCost": 992.31,
    "b6Quantity": 0.6,
    "b6Total": 595.386,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "ketchup",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 2,
    "b6Total": 400,
    "sdjQuantity": 0.4,
    "sdjTotal": 80,
    "bucket": "FOOD"
  },
  {
    "name": "wasabi",
    "sourceUnit": "43g",
    "unitCost": 200,
    "b6Quantity": 3,
    "b6Total": 600,
    "sdjQuantity": 1,
    "sdjTotal": 200,
    "bucket": "FOOD"
  },
  {
    "name": "avocado",
    "sourceUnit": "kg",
    "unitCost": 800,
    "b6Quantity": 1.3,
    "b6Total": 1040,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "lotus root",
    "sourceUnit": "kg",
    "unitCost": 300,
    "b6Quantity": 0.6,
    "b6Total": 180,
    "sdjQuantity": 0.55,
    "sdjTotal": 165,
    "bucket": "FOOD"
  },
  {
    "name": "enoki mushroom",
    "sourceUnit": "Gm",
    "unitCost": 240,
    "b6Quantity": 0.2,
    "b6Total": 48,
    "sdjQuantity": 0.15,
    "sdjTotal": 36,
    "bucket": "FOOD"
  },
  {
    "name": "potato starch",
    "sourceUnit": "kg",
    "unitCost": 301.2,
    "b6Quantity": 0.5,
    "b6Total": 150.6,
    "sdjQuantity": 0.45,
    "sdjTotal": 135.54,
    "bucket": "FOOD"
  },
  {
    "name": "tapioca starch",
    "sourceUnit": "kg",
    "unitCost": 148,
    "b6Quantity": 0.3,
    "b6Total": 44.4,
    "sdjQuantity": 0.5,
    "sdjTotal": 74,
    "bucket": "FOOD"
  },
  {
    "name": "bamboo shoot",
    "sourceUnit": "kg",
    "unitCost": 201.88,
    "b6Quantity": 0.425,
    "b6Total": 85.79899999999999,
    "sdjQuantity": 3.312,
    "sdjTotal": 668.6265599999999,
    "bucket": "FOOD"
  },
  {
    "name": "ramen noodle",
    "sourceUnit": "carton",
    "unitCost": 2800,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Bird eye chilli",
    "sourceUnit": "Gm(100)",
    "unitCost": 150,
    "b6Quantity": 0.27,
    "b6Total": 40.5,
    "sdjQuantity": 0.14,
    "sdjTotal": 21.000000000000004,
    "bucket": "FOOD"
  },
  {
    "name": "tomato chilli",
    "sourceUnit": "kg",
    "unitCost": 700,
    "b6Quantity": 0.643,
    "b6Total": 450.1,
    "sdjQuantity": 1,
    "sdjTotal": 700,
    "bucket": "FOOD"
  },
  {
    "name": "quiinoa",
    "sourceUnit": "kg",
    "unitCost": 1400,
    "b6Quantity": 3,
    "b6Total": 4200,
    "sdjQuantity": 2,
    "sdjTotal": 2800,
    "bucket": "FOOD"
  },
  {
    "name": "Paneer",
    "sourceUnit": "kg",
    "unitCost": 280,
    "b6Quantity": 0.3,
    "b6Total": 84,
    "sdjQuantity": 0.4,
    "sdjTotal": 112,
    "bucket": "FOOD"
  },
  {
    "name": "tofu",
    "sourceUnit": "kg",
    "unitCost": 168,
    "b6Quantity": 1.5,
    "b6Total": 252,
    "sdjQuantity": 1,
    "sdjTotal": 168,
    "bucket": "FOOD"
  },
  {
    "name": "edamame bean",
    "sourceUnit": "kg",
    "unitCost": 446,
    "b6Quantity": 0.6,
    "b6Total": 267.59999999999997,
    "sdjQuantity": 1.3,
    "sdjTotal": 579.8000000000001,
    "bucket": "FOOD"
  },
  {
    "name": "fried onion",
    "sourceUnit": "kg",
    "unitCost": 170,
    "b6Quantity": 1,
    "b6Total": 170,
    "sdjQuantity": 1,
    "sdjTotal": 170,
    "bucket": "FOOD"
  },
  {
    "name": "white sesame seed",
    "sourceUnit": "kg",
    "unitCost": 300,
    "b6Quantity": 0.695,
    "b6Total": 208.49999999999997,
    "sdjQuantity": 0.7,
    "sdjTotal": 210,
    "bucket": "FOOD"
  },
  {
    "name": "black sesame seed",
    "sourceUnit": "kg",
    "unitCost": 600,
    "b6Quantity": 0.418,
    "b6Total": 250.79999999999998,
    "sdjQuantity": 0.56,
    "sdjTotal": 336.00000000000006,
    "bucket": "FOOD"
  },
  {
    "name": "bread crumb",
    "sourceUnit": "kg",
    "unitCost": 160,
    "b6Quantity": 0.914,
    "b6Total": 146.24,
    "sdjQuantity": 1,
    "sdjTotal": 160,
    "bucket": "FOOD"
  },
  {
    "name": "miso paste",
    "sourceUnit": "kg",
    "unitCost": 376,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "white choco",
    "sourceUnit": "kg",
    "unitCost": 332,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "dark choco",
    "sourceUnit": "kg",
    "unitCost": 572,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "combu",
    "sourceUnit": "kg",
    "unitCost": 1350,
    "b6Quantity": 0.22,
    "b6Total": 297,
    "sdjQuantity": 0.65,
    "sdjTotal": 877.5,
    "bucket": "FOOD"
  },
  {
    "name": "shitake",
    "sourceUnit": "kg",
    "unitCost": 1350,
    "b6Quantity": 1.1,
    "b6Total": 1485.0000000000002,
    "sdjQuantity": 0.8,
    "sdjTotal": 1080,
    "bucket": "FOOD"
  },
  {
    "name": "white vinegar",
    "sourceUnit": "litre",
    "unitCost": 68,
    "b6Quantity": 0.343,
    "b6Total": 23.324,
    "sdjQuantity": 1.7,
    "sdjTotal": 115.6,
    "bucket": "FOOD"
  },
  {
    "name": "flying goose sriracha",
    "sourceUnit": "litre",
    "unitCost": 492,
    "b6Quantity": 0.77,
    "b6Total": 378.84000000000003,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "oyster sauce non veg",
    "sourceUnit": "litre",
    "unitCost": 301.64,
    "b6Quantity": 2.2,
    "b6Total": 663.6080000000001,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "leekumki dark soya",
    "sourceUnit": "litre",
    "unitCost": 430.1,
    "b6Quantity": 0.85,
    "b6Total": 365.585,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "leekumki light soya",
    "sourceUnit": "litre",
    "unitCost": 325.26,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "leekumki veg oyester",
    "sourceUnit": "kg",
    "unitCost": 446,
    "b6Quantity": 0.5,
    "b6Total": 223,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "roasted seaweed",
    "sourceUnit": "140g",
    "unitCost": 700,
    "b6Quantity": 0.4,
    "b6Total": 280,
    "sdjQuantity": 0.1,
    "sdjTotal": 70,
    "bucket": "FOOD"
  },
  {
    "name": "gochujang",
    "sourceUnit": "kg",
    "unitCost": 382.2,
    "b6Quantity": 1,
    "b6Total": 382.2,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "kikkoman soy sauce",
    "sourceUnit": "litre",
    "unitCost": 356,
    "b6Quantity": 2,
    "b6Total": 712,
    "sdjQuantity": 1,
    "sdjTotal": 356,
    "bucket": "FOOD"
  },
  {
    "name": "amul diced mozarella",
    "sourceUnit": "kg",
    "unitCost": 550,
    "b6Quantity": 0.5,
    "b6Total": 275,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "maida",
    "sourceUnit": "kg",
    "unitCost": 40,
    "b6Quantity": 7.5,
    "b6Total": 300,
    "sdjQuantity": 4,
    "sdjTotal": 160,
    "bucket": "FOOD"
  },
  {
    "name": "dry red chilli",
    "sourceUnit": "kg",
    "unitCost": 250,
    "b6Quantity": 1.087,
    "b6Total": 271.75,
    "sdjQuantity": 0.15,
    "sdjTotal": 37.5,
    "bucket": "FOOD"
  },
  {
    "name": "peanut butter",
    "sourceUnit": "750g",
    "unitCost": 187,
    "b6Quantity": 0.75,
    "b6Total": 140.25,
    "sdjQuantity": 1,
    "sdjTotal": 187,
    "bucket": "FOOD"
  },
  {
    "name": "Tabasco",
    "sourceUnit": "ml",
    "unitCost": 200,
    "b6Quantity": 0.36,
    "b6Total": 72,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "corn flour",
    "sourceUnit": "kg",
    "unitCost": 50,
    "b6Quantity": 4.5,
    "b6Total": 225,
    "sdjQuantity": 3.3,
    "sdjTotal": 165,
    "bucket": "FOOD"
  },
  {
    "name": "oil",
    "sourceUnit": "litre",
    "unitCost": 120,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "salt",
    "sourceUnit": "kg",
    "unitCost": 30,
    "b6Quantity": 2,
    "b6Total": 60,
    "sdjQuantity": 1,
    "sdjTotal": 30,
    "bucket": "FOOD"
  },
  {
    "name": "salted butter",
    "sourceUnit": "kg",
    "unitCost": 590,
    "b6Quantity": 0.52,
    "b6Total": 306.8,
    "sdjQuantity": 0.5,
    "sdjTotal": 295,
    "bucket": "FOOD"
  },
  {
    "name": "unsalted butter",
    "sourceUnit": "kg",
    "unitCost": 656,
    "b6Quantity": 0.45,
    "b6Total": 295.2,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "soda",
    "sourceUnit": "ml",
    "unitCost": 15,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 30,
    "sdjTotal": 450,
    "bucket": "FOOD"
  },
  {
    "name": "black pepper",
    "sourceUnit": "kg",
    "unitCost": 1500,
    "b6Quantity": 0.07,
    "b6Total": 105.00000000000001,
    "sdjQuantity": 0.2,
    "sdjTotal": 300,
    "bucket": "FOOD"
  },
  {
    "name": "d'lecta cheddar cheese",
    "sourceUnit": "kg",
    "unitCost": 950,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "d'lecta cream cheese",
    "sourceUnit": "kg",
    "unitCost": 679,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "d'lecta mascarpone",
    "sourceUnit": "kg",
    "unitCost": 717.5,
    "b6Quantity": 0.5,
    "b6Total": 358.75,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "d'lecta whipping cream",
    "sourceUnit": "kg",
    "unitCost": 170,
    "b6Quantity": 5,
    "b6Total": 850,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "poke rice",
    "sourceUnit": "kg",
    "unitCost": 130,
    "b6Quantity": 7,
    "b6Total": 910,
    "sdjQuantity": 4,
    "sdjTotal": 520,
    "bucket": "FOOD"
  },
  {
    "name": "purple cabbage",
    "sourceUnit": "kg",
    "unitCost": 120,
    "b6Quantity": 5.6,
    "b6Total": 672,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "kashmiri chilli whole",
    "sourceUnit": "kg",
    "unitCost": 457,
    "b6Quantity": 0.5,
    "b6Total": 228.5,
    "sdjQuantity": 0.46,
    "sdjTotal": 210.22,
    "bucket": "FOOD"
  },
  {
    "name": "green cabbage",
    "sourceUnit": "kg",
    "unitCost": 30,
    "b6Quantity": 4.5,
    "b6Total": 135,
    "sdjQuantity": 0.68,
    "sdjTotal": 20.400000000000002,
    "bucket": "FOOD"
  },
  {
    "name": "spring onion",
    "sourceUnit": "kg",
    "unitCost": 60,
    "b6Quantity": 2.15,
    "b6Total": 129,
    "sdjQuantity": 0.1,
    "sdjTotal": 6,
    "bucket": "FOOD"
  },
  {
    "name": "leek",
    "sourceUnit": "kg",
    "unitCost": 400,
    "b6Quantity": 0.4,
    "b6Total": 160,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "onion",
    "sourceUnit": "kg",
    "unitCost": 30,
    "b6Quantity": 5,
    "b6Total": 150,
    "sdjQuantity": 1.2,
    "sdjTotal": 36,
    "bucket": "FOOD"
  },
  {
    "name": "mushroom",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 3.9,
    "b6Total": 780,
    "sdjQuantity": 0.15,
    "sdjTotal": 30,
    "bucket": "FOOD"
  },
  {
    "name": "cauliflower",
    "sourceUnit": "kg",
    "unitCost": 40,
    "b6Quantity": 1.3,
    "b6Total": 52,
    "sdjQuantity": 0.4,
    "sdjTotal": 16,
    "bucket": "FOOD"
  },
  {
    "name": "malta",
    "sourceUnit": "kg",
    "unitCost": 170,
    "b6Quantity": 4.3,
    "b6Total": 731,
    "sdjQuantity": 2,
    "sdjTotal": 340,
    "bucket": "FOOD"
  },
  {
    "name": "ginger",
    "sourceUnit": "kg",
    "unitCost": 100,
    "b6Quantity": 1,
    "b6Total": 100,
    "sdjQuantity": 0.14,
    "sdjTotal": 14.000000000000002,
    "bucket": "FOOD"
  },
  {
    "name": "Sweetcorn",
    "sourceUnit": "kg",
    "unitCost": 105,
    "b6Quantity": 6.7,
    "b6Total": 703.5,
    "sdjQuantity": 3.4,
    "sdjTotal": 357,
    "bucket": "FOOD"
  },
  {
    "name": "garlic",
    "sourceUnit": "kg",
    "unitCost": 300,
    "b6Quantity": 4.5,
    "b6Total": 1350,
    "sdjQuantity": 1,
    "sdjTotal": 300,
    "bucket": "FOOD"
  },
  {
    "name": "carrot",
    "sourceUnit": "kg",
    "unitCost": 50,
    "b6Quantity": 4,
    "b6Total": 200,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "red capsicum",
    "sourceUnit": "kg",
    "unitCost": 300,
    "b6Quantity": 0.25,
    "b6Total": 75,
    "sdjQuantity": 0.7,
    "sdjTotal": 210,
    "bucket": "FOOD"
  },
  {
    "name": "bean",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 0.4,
    "b6Total": 80,
    "sdjQuantity": 0.2,
    "sdjTotal": 40,
    "bucket": "FOOD"
  },
  {
    "name": "lemon",
    "sourceUnit": "kg",
    "unitCost": 160,
    "b6Quantity": 2.4,
    "b6Total": 384,
    "sdjQuantity": 0.17,
    "sdjTotal": 27.200000000000003,
    "bucket": "FOOD"
  },
  {
    "name": "pumpkin",
    "sourceUnit": "kg",
    "unitCost": 30,
    "b6Quantity": 0.2,
    "b6Total": 6,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "squash",
    "sourceUnit": "kg",
    "unitCost": 150,
    "b6Quantity": 0.3,
    "b6Total": 45,
    "sdjQuantity": 0.17,
    "sdjTotal": 25.500000000000004,
    "bucket": "FOOD"
  },
  {
    "name": "spinach",
    "sourceUnit": "kg",
    "unitCost": 40,
    "b6Quantity": 2.3,
    "b6Total": 92,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "coriander",
    "sourceUnit": "kg",
    "unitCost": 60,
    "b6Quantity": 0.3,
    "b6Total": 18,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "chieves",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "enoki mushroom",
    "sourceUnit": "kg",
    "unitCost": 1000,
    "b6Quantity": 0.21,
    "b6Total": 210,
    "sdjQuantity": 0.15,
    "sdjTotal": 150,
    "bucket": "FOOD"
  },
  {
    "name": "raddish",
    "sourceUnit": "kg",
    "unitCost": 50,
    "b6Quantity": 0.3,
    "b6Total": 15,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "cucumber",
    "sourceUnit": "kg",
    "unitCost": 60,
    "b6Quantity": 4,
    "b6Total": 240,
    "sdjQuantity": 0.47,
    "sdjTotal": 28.2,
    "bucket": "FOOD"
  },
  {
    "name": "Chilli flakes",
    "sourceUnit": "kg",
    "unitCost": 450,
    "b6Quantity": 0.54,
    "b6Total": 243.00000000000003,
    "sdjQuantity": 0.5,
    "sdjTotal": 225,
    "bucket": "FOOD"
  },
  {
    "name": "Garlic powder",
    "sourceUnit": "kg",
    "unitCost": 562.5,
    "b6Quantity": 0.4,
    "b6Total": 225,
    "sdjQuantity": 0.37,
    "sdjTotal": 208.125,
    "bucket": "FOOD"
  },
  {
    "name": "Parsley",
    "sourceUnit": "kg",
    "unitCost": 2800,
    "b6Quantity": 0.08,
    "b6Total": 224,
    "sdjQuantity": 0.1,
    "sdjTotal": 280,
    "bucket": "FOOD"
  },
  {
    "name": "vegan butter",
    "sourceUnit": "kg",
    "unitCost": 950,
    "b6Quantity": 0.08,
    "b6Total": 76,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Bread",
    "sourceUnit": "kg",
    "unitCost": 250,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Chocolate ice cream",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 1.5,
    "b6Total": 300,
    "sdjQuantity": 0.33,
    "sdjTotal": 66,
    "bucket": "FOOD"
  },
  {
    "name": "Strawberry ice cream",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 2.6,
    "b6Total": 520,
    "sdjQuantity": 2.2,
    "sdjTotal": 440.00000000000006,
    "bucket": "FOOD"
  },
  {
    "name": "Ginger powder",
    "sourceUnit": "kg",
    "unitCost": 1000,
    "b6Quantity": 0.4,
    "b6Total": 400,
    "sdjQuantity": 0.14,
    "sdjTotal": 140,
    "bucket": "FOOD"
  },
  {
    "name": "Cinnamon powder",
    "sourceUnit": "kg",
    "unitCost": 1562.5,
    "b6Quantity": 0.353,
    "b6Total": 551.5625,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Baking powder",
    "sourceUnit": "kg",
    "unitCost": 257.5,
    "b6Quantity": 0.35,
    "b6Total": 90.125,
    "sdjQuantity": 0.1,
    "sdjTotal": 25.75,
    "bucket": "FOOD"
  },
  {
    "name": "Nori sheet",
    "sourceUnit": "50gm",
    "unitCost": 650,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "gochujang",
    "sourceUnit": "kg",
    "unitCost": 455,
    "b6Quantity": 0.624,
    "b6Total": 283.92,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Mascarpone",
    "sourceUnit": "kg",
    "unitCost": 1200,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Eggs ( white)",
    "sourceUnit": "30pcs",
    "unitCost": 250,
    "b6Quantity": 5,
    "b6Total": 1250,
    "sdjQuantity": 2,
    "sdjTotal": 500,
    "bucket": "FOOD"
  },
  {
    "name": "Eggs ( brown)",
    "sourceUnit": "30pcs",
    "unitCost": 250,
    "b6Quantity": 2,
    "b6Total": 500,
    "sdjQuantity": 13,
    "sdjTotal": 108,
    "bucket": "FOOD"
  },
  {
    "name": "Sugar",
    "sourceUnit": "kg",
    "unitCost": 48,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Poke rice",
    "sourceUnit": "kg",
    "unitCost": 130,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Red food colour",
    "sourceUnit": "kg",
    "unitCost": 2000,
    "b6Quantity": 0.07,
    "b6Total": 140,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Black pepper",
    "sourceUnit": "kg",
    "unitCost": 1500,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0.2,
    "sdjTotal": 300,
    "bucket": "FOOD"
  },
  {
    "name": "Umai dry seaweed",
    "sourceUnit": "kg",
    "unitCost": 850,
    "b6Quantity": 0.511,
    "b6Total": 434.35,
    "sdjQuantity": 0.23,
    "sdjTotal": 195.5,
    "bucket": "FOOD"
  },
  {
    "name": "Custard powder",
    "sourceUnit": "kg",
    "unitCost": 340,
    "b6Quantity": 0.94,
    "b6Total": 319.59999999999997,
    "sdjQuantity": 0.23,
    "sdjTotal": 78.2,
    "bucket": "FOOD"
  },
  {
    "name": "Chilli powder",
    "sourceUnit": "kg",
    "unitCost": 405,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Szechuan pepper",
    "sourceUnit": "kg",
    "unitCost": 1000,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0.14,
    "sdjTotal": 140,
    "bucket": "FOOD"
  },
  {
    "name": "Ajinamoto",
    "sourceUnit": "kg",
    "unitCost": 600,
    "b6Quantity": 0.463,
    "b6Total": 277.8,
    "sdjQuantity": 0.2,
    "sdjTotal": 120,
    "bucket": "FOOD"
  },
  {
    "name": "Jeera",
    "sourceUnit": "kg",
    "unitCost": 298,
    "b6Quantity": 0.309,
    "b6Total": 92.082,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Gochugaru powder",
    "sourceUnit": "kg",
    "unitCost": 1760,
    "b6Quantity": 1.5,
    "b6Total": 2640,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "King chilli",
    "sourceUnit": "kg",
    "unitCost": 900,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Doubanjiang",
    "sourceUnit": "kg",
    "unitCost": 980,
    "b6Quantity": 0.14,
    "b6Total": 137.20000000000002,
    "sdjQuantity": 0.17,
    "sdjTotal": 166.60000000000002,
    "bucket": "FOOD"
  },
  {
    "name": "Wasabi powder",
    "sourceUnit": "kg",
    "unitCost": 200,
    "b6Quantity": 1,
    "b6Total": 200,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "English custard",
    "sourceUnit": "kg",
    "unitCost": 806.17,
    "b6Quantity": 0.145,
    "b6Total": 116.89464999999998,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Apple cider veniger",
    "sourceUnit": "litre",
    "unitCost": 148,
    "b6Quantity": 1.5,
    "b6Total": 222,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Tahini",
    "sourceUnit": "kg",
    "unitCost": 452.31,
    "b6Quantity": 0.65,
    "b6Total": 294.0015,
    "sdjQuantity": 0.7,
    "sdjTotal": 316.61699999999996,
    "bucket": "FOOD"
  },
  {
    "name": "Tofu",
    "sourceUnit": "kg",
    "unitCost": 172,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "FOOD"
  },
  {
    "name": "Cinnamon stick",
    "sourceUnit": "kg",
    "unitCost": 315,
    "b6Quantity": 0.714,
    "b6Total": 224.91,
    "sdjQuantity": 0.7,
    "sdjTotal": 220.5,
    "bucket": "FOOD"
  },
  {
    "name": "Naruto maki fish cake",
    "sourceUnit": "gm (134)",
    "unitCost": 320,
    "b6Quantity": 2.53,
    "b6Total": 809.5999999999999,
    "sdjQuantity": 0.8,
    "sdjTotal": 256,
    "bucket": "FOOD"
  },
  {
    "name": "brown sugar",
    "sourceUnit": "kg",
    "unitCost": 100,
    "b6Quantity": 2,
    "b6Total": 200,
    "sdjQuantity": 1.664,
    "sdjTotal": 166.4,
    "bucket": "DRINKS"
  },
  {
    "name": "sugar",
    "sourceUnit": "kg",
    "unitCost": 48,
    "b6Quantity": 3.5,
    "b6Total": 168,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "matcha (C)",
    "sourceUnit": "kg",
    "unitCost": 12506,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0.188,
    "sdjTotal": 2351.128,
    "bucket": "DRINKS"
  },
  {
    "name": "milk",
    "sourceUnit": "litre",
    "unitCost": 70,
    "b6Quantity": 30,
    "b6Total": 2100,
    "sdjQuantity": 17,
    "sdjTotal": 1190,
    "bucket": "DRINKS"
  },
  {
    "name": "Condensed milk",
    "sourceUnit": "litre",
    "unitCost": 317,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 1,
    "sdjTotal": 317,
    "bucket": "DRINKS"
  },
  {
    "name": "Ina matcha",
    "sourceUnit": "kg",
    "unitCost": 5200,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0.166,
    "sdjTotal": 863.2,
    "bucket": "DRINKS"
  },
  {
    "name": "cocoa powder",
    "sourceUnit": "kg",
    "unitCost": 355,
    "b6Quantity": 0.45,
    "b6Total": 159.75,
    "sdjQuantity": 0.225,
    "sdjTotal": 79.875,
    "bucket": "DRINKS"
  },
  {
    "name": "davinci chocolate",
    "sourceUnit": "kg",
    "unitCost": 365.4,
    "b6Quantity": 5,
    "b6Total": 1827,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "Mitesh taro",
    "sourceUnit": "kg",
    "unitCost": 1260,
    "b6Quantity": 2.5,
    "b6Total": 3150,
    "sdjQuantity": 1,
    "sdjTotal": 1260,
    "bucket": "DRINKS"
  },
  {
    "name": "Taro tea planet",
    "sourceUnit": "kg",
    "unitCost": 1116.4,
    "b6Quantity": 3.5,
    "b6Total": 3907.4000000000005,
    "sdjQuantity": 1,
    "sdjTotal": 1116.4,
    "bucket": "DRINKS"
  },
  {
    "name": "Creamer",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 2,
    "b6Total": 945,
    "sdjQuantity": 0.5,
    "sdjTotal": 236.25,
    "bucket": "DRINKS"
  },
  {
    "name": "Hermit coffee",
    "sourceUnit": "kg",
    "unitCost": 1150,
    "b6Quantity": 2.5,
    "b6Total": 2875,
    "sdjQuantity": 6,
    "sdjTotal": 6900,
    "bucket": "DRINKS"
  },
  {
    "name": "coffee bean",
    "sourceUnit": "kg",
    "unitCost": 1365,
    "b6Quantity": 1,
    "b6Total": 1365,
    "sdjQuantity": 2,
    "sdjTotal": 2730,
    "bucket": "DRINKS"
  },
  {
    "name": "Tapioca pearl",
    "sourceUnit": "kg",
    "unitCost": 850.5,
    "b6Quantity": 1,
    "b6Total": 850.5,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "oat milk",
    "sourceUnit": "ml",
    "unitCost": 62,
    "b6Quantity": 20,
    "b6Total": 1240,
    "sdjQuantity": 17,
    "sdjTotal": 1054,
    "bucket": "DRINKS"
  },
  {
    "name": "frozen raspberry",
    "sourceUnit": "kg",
    "unitCost": 1669.5,
    "b6Quantity": 2,
    "b6Total": 3339,
    "sdjQuantity": 0.8,
    "sdjTotal": 1335.6000000000001,
    "bucket": "DRINKS"
  },
  {
    "name": "frozen strawberry",
    "sourceUnit": "kg",
    "unitCost": 514.5,
    "b6Quantity": 3.6,
    "b6Total": 1852.2,
    "sdjQuantity": 3.46,
    "sdjTotal": 1780.17,
    "bucket": "DRINKS"
  },
  {
    "name": "frozen blueberry",
    "sourceUnit": "kg",
    "unitCost": 650,
    "b6Quantity": 2.9,
    "b6Total": 1885,
    "sdjQuantity": 3,
    "sdjTotal": 1950,
    "bucket": "DRINKS"
  },
  {
    "name": "canned cherry",
    "sourceUnit": "kg",
    "unitCost": 182.17,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "kinnow oranges",
    "sourceUnit": "kg",
    "unitCost": 65,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "nagpur oranges",
    "sourceUnit": "kg",
    "unitCost": 139,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "mango pulp",
    "sourceUnit": "kg",
    "unitCost": 238.41,
    "b6Quantity": 3,
    "b6Total": 715.23,
    "sdjQuantity": 2.55,
    "sdjTotal": 607.9454999999999,
    "bucket": "DRINKS"
  },
  {
    "name": "chia seed",
    "sourceUnit": "kg",
    "unitCost": 1180,
    "b6Quantity": 0.9,
    "b6Total": 1062,
    "sdjQuantity": 0.25,
    "sdjTotal": 295,
    "bucket": "DRINKS"
  },
  {
    "name": "pea flower tea",
    "sourceUnit": "kg",
    "unitCost": 8333.33,
    "b6Quantity": 0.04,
    "b6Total": 333.3332,
    "sdjQuantity": 0.082,
    "sdjTotal": 683.33306,
    "bucket": "DRINKS"
  },
  {
    "name": "basil seed",
    "sourceUnit": "kg",
    "unitCost": 1475,
    "b6Quantity": 0.023,
    "b6Total": 33.925,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "coconut milk",
    "sourceUnit": "litre",
    "unitCost": 363,
    "b6Quantity": 0.4,
    "b6Total": 145.20000000000002,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "green tea",
    "sourceUnit": "kg",
    "unitCost": 1398,
    "b6Quantity": 0.3,
    "b6Total": 419.4,
    "sdjQuantity": 0.338,
    "sdjTotal": 472.52400000000006,
    "bucket": "DRINKS"
  },
  {
    "name": "Passion fruit crush",
    "sourceUnit": "litre",
    "unitCost": 325.5,
    "b6Quantity": 2.5,
    "b6Total": 813.75,
    "sdjQuantity": 1,
    "sdjTotal": 325.5,
    "bucket": "DRINKS"
  },
  {
    "name": "Passion fruit",
    "sourceUnit": "litre",
    "unitCost": 420,
    "b6Quantity": 3,
    "b6Total": 1260,
    "sdjQuantity": 4,
    "sdjTotal": 1680,
    "bucket": "DRINKS"
  },
  {
    "name": "peach",
    "sourceUnit": "litre",
    "unitCost": 420,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "Strawberry Crush",
    "sourceUnit": "litre",
    "unitCost": 235.2,
    "b6Quantity": 2,
    "b6Total": 470.4,
    "sdjQuantity": 4,
    "sdjTotal": 940.8,
    "bucket": "DRINKS"
  },
  {
    "name": "Raspberry",
    "sourceUnit": "litre",
    "unitCost": 530,
    "b6Quantity": 2,
    "b6Total": 1060,
    "sdjQuantity": 1,
    "sdjTotal": 530,
    "bucket": "DRINKS"
  },
  {
    "name": "mango crush",
    "sourceUnit": "litre",
    "unitCost": 241,
    "b6Quantity": 1,
    "b6Total": 241,
    "sdjQuantity": 4,
    "sdjTotal": 964,
    "bucket": "DRINKS"
  },
  {
    "name": "Lychee crush",
    "sourceUnit": "litre",
    "unitCost": 213,
    "b6Quantity": 2.2,
    "b6Total": 468.6,
    "sdjQuantity": 1,
    "sdjTotal": 213,
    "bucket": "DRINKS"
  },
  {
    "name": "Blueberry crush",
    "sourceUnit": "litre",
    "unitCost": 405.3,
    "b6Quantity": 4,
    "b6Total": 1621.2,
    "sdjQuantity": 4,
    "sdjTotal": 1621.2,
    "bucket": "DRINKS"
  },
  {
    "name": "Orange crush",
    "sourceUnit": "litre",
    "unitCost": 257.26,
    "b6Quantity": 1.2,
    "b6Total": 308.712,
    "sdjQuantity": 0.75,
    "sdjTotal": 192.945,
    "bucket": "DRINKS"
  },
  {
    "name": "caramel sauce",
    "sourceUnit": "kg",
    "unitCost": 391.676,
    "b6Quantity": 1,
    "b6Total": 391.676,
    "sdjQuantity": 0.6,
    "sdjTotal": 235.0056,
    "bucket": "DRINKS"
  },
  {
    "name": "boba passion friut",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 4,
    "b6Total": 1890,
    "sdjQuantity": 19.2,
    "sdjTotal": 9072,
    "bucket": "DRINKS"
  },
  {
    "name": "mitesh passion fruit",
    "sourceUnit": "kg",
    "unitCost": 1,
    "b6Quantity": 0,
    "b6Total": 0,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "peach",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 3,
    "b6Total": 1417.5,
    "sdjQuantity": 25.6,
    "sdjTotal": 12096,
    "bucket": "DRINKS"
  },
  {
    "name": "mango",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 2,
    "b6Total": 945,
    "sdjQuantity": 16,
    "sdjTotal": 7560,
    "bucket": "DRINKS"
  },
  {
    "name": "strawberry",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 5,
    "b6Total": 2362.5,
    "sdjQuantity": 22.4,
    "sdjTotal": 10584,
    "bucket": "DRINKS"
  },
  {
    "name": "raspberry",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 10,
    "b6Total": 4725,
    "sdjQuantity": 0,
    "sdjTotal": 0,
    "bucket": "DRINKS"
  },
  {
    "name": "lychee",
    "sourceUnit": "kg",
    "unitCost": 472.5,
    "b6Quantity": 3,
    "b6Total": 1417.5,
    "sdjQuantity": 6.4,
    "sdjTotal": 3024,
    "bucket": "DRINKS"
  },
  {
    "name": "thai tea",
    "sourceUnit": "grm",
    "unitCost": 525,
    "b6Quantity": 0.35,
    "b6Total": 183.75,
    "sdjQuantity": 2,
    "sdjTotal": 1050,
    "bucket": "DRINKS"
  },
  {
    "name": "vanilla ice cream",
    "sourceUnit": "litre",
    "unitCost": 100,
    "b6Quantity": 1.8,
    "b6Total": 180,
    "sdjQuantity": 0.68,
    "sdjTotal": 68,
    "bucket": "DRINKS"
  }
];
