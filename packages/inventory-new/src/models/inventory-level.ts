import {
  BeforeCreate,
  Entity,
  Filter,
  ManyToOne,
  OnInit,
  PrimaryKey,
  Property,
} from "@mikro-orm/core"

import { DALUtils } from "@medusajs/utils"
import { InventoryItem } from "./inventory-item"
import { createPsqlIndexStatementHelper } from "@medusajs/utils"
import { generateEntityId } from "@medusajs/utils"

const InventoryLevelDeletedAtIndex = createPsqlIndexStatementHelper({
  tableName: "inventory_level",
  columns: "deleted_at",
  where: "deleted_at IS NOT NULL",
})

const InventoryLevelInventoryItemIdIndex = createPsqlIndexStatementHelper({
  tableName: "inventory_level",
  columns: "inventory_item_id",
})

const InventoryLevelLocationIdIndex = createPsqlIndexStatementHelper({
  tableName: "inventory_level",
  columns: "location_id",
})

const InventoryLevelLocationIdInventoryItemIdIndex =
  createPsqlIndexStatementHelper({
    tableName: "inventory_level",
    columns: "location_id",
  })

@Entity()
@InventoryLevelLocationIdInventoryItemIdIndex.MikroOrmIndex()
@Filter(DALUtils.mikroOrmSoftDeletableFilterOptions)
export class InventoryLevel {
  @PrimaryKey({ columnType: "text" })
  id: string

  @Property({
    onCreate: () => new Date(),
    columnType: "timestamptz",
    defaultRaw: "now()",
  })
  created_at: Date

  @Property({
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    columnType: "timestamptz",
    defaultRaw: "now()",
  })
  updated_at: Date

  @InventoryLevelDeletedAtIndex.MikroORMIndex()
  @Property({ columnType: "timestamptz", nullable: true })
  deleted_at: Date | null = null

  @InventoryLevelInventoryItemIdIndex.MikroORMIndex()
  @Property({ type: "text" })
  inventory_item_id: string

  @InventoryLevelLocationIdIndex.MikroORMIndex()
  @Property({ type: "text" })
  location_id: string

  @Property({ type: "int" })
  stocked_quantity: number = 0

  @Property({ type: "int" })
  reserved_quantity: number = 0

  @Property({ type: "int" })
  incoming_quantity: number = 0

  @Property({ columnType: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null

  @ManyToOne(() => InventoryItem, {
    joinColumn: "inventory_item_id",
  })
  inventory_item: InventoryItem

  @BeforeCreate()
  private beforeCreate(): void {
    this.id = generateEntityId(this.id, "ilev")
  }

  @OnInit()
  private onInit(): void {
    this.id = generateEntityId(this.id, "ilev")
  }
}
