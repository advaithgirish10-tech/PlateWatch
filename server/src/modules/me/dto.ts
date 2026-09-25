import { eq } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { restaurantOwners } from "../../db/schema.js";
import { displayPhone } from "../../lib/phone.js";

export async function userDto(
  db: Queryable,
  u: { id: string; phone: string; name: string | null; role: "user" | "admin"; whatsappAlerts: boolean; phoneVerifiedAt: Date },
) {
  const owned = await db.select({ id: restaurantOwners.restaurantId }).from(restaurantOwners).where(eq(restaurantOwners.userId, u.id));
  return {
    id: u.id,
    phone: u.phone,
    displayPhone: displayPhone(u.phone),
    name: u.name,
    role: u.role,
    whatsappAlerts: u.whatsappAlerts,
    phoneVerifiedAt: u.phoneVerifiedAt.toISOString(),
    ownedRestaurantIds: owned.map((o) => o.id),
  };
}
