"""Core fulfillment service for order processing and task management."""

from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from loguru import logger

from smplat_api.models.order import Order, OrderItem, OrderStatusEnum
from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.product import Product
from smplat_api.services.notifications import NotificationService
from .instagram_service import InstagramService


class FulfillmentService:
    """Service for managing order fulfillment and service delivery."""
    
    def __init__(
        self,
        db_session: AsyncSession,
        *,
        notification_service: NotificationService | None = None,
    ):
        """Initialize fulfillment service.
        
        Args:
            db_session: Database session for operations
        """
        self.db = db_session
        self.instagram_service = InstagramService(db_session)
        self.notification_service = notification_service or NotificationService(db_session)
        
    async def process_order_fulfillment(self, order_id: UUID) -> bool:
        """Process fulfillment for a paid order.
        
        This method creates fulfillment tasks and campaigns for all order items.
        
        Args:
            order_id: Order ID to process
            
        Returns:
            True if fulfillment processing started successfully
        """
        try:
            # Get order with items
            stmt = select(Order).options(selectinload(Order.items)).where(Order.id == order_id)
            result = await self.db.execute(stmt)
            order = result.scalar_one_or_none()
            
            if not order:
                logger.error("Order not found for fulfillment", order_id=str(order_id))
                return False
                
            if order.status != OrderStatusEnum.PENDING:
                logger.info("Order not in pending status", order_id=str(order_id), status=order.status.value)
                return False
                
            # Update order status to processing
            previous_status = order.status
            order.status = OrderStatusEnum.PROCESSING
            await self.db.flush()
            await self.notification_service.send_order_status_update(
                order,
                previous_status=previous_status,
                trigger="fulfillment_kickoff",
            )
            
            # Process each order item
            for item in order.items:
                await self._create_fulfillment_tasks_for_item(item)

            items_count = len(order.items)
            await self.db.commit()

            logger.info(
                "Started fulfillment processing for order",
                order_id=str(order_id),
                items_count=items_count
            )
            
            return True
            
        except Exception as e:
            logger.exception(
                "Failed to process order fulfillment",
                order_id=str(order_id),
                error=str(e)
            )
            await self.db.rollback()
            return False
            
    async def _create_fulfillment_tasks_for_item(self, order_item: OrderItem) -> None:
        """Create fulfillment tasks for a specific order item.
        
        Args:
            order_item: Order item to create tasks for
        """
        # Get product details to determine service type
        if not order_item.product_id:
            logger.warning("Order item has no product_id", item_id=str(order_item.id))
            return
            
        stmt = select(Product).where(Product.id == order_item.product_id)
        result = await self.db.execute(stmt)
        product = result.scalar_one_or_none()
        
        if not product:
            logger.warning("Product not found for order item", item_id=str(order_item.id))
            return
            
        # Configurable fulfillment overrides category defaults
        if product.fulfillment_config:
            await self._create_configurable_fulfillment_tasks(order_item, product)
            return

        # Create tasks based on product category
        if product.category.lower() == "instagram":
            await self._create_instagram_fulfillment_tasks(order_item, product)
        else:
            # Default fulfillment tasks for other categories
            await self._create_generic_fulfillment_tasks(order_item, product)
            
    async def _create_instagram_fulfillment_tasks(self, order_item: OrderItem, product: Product) -> None:
        """Create Instagram-specific fulfillment tasks.
        
        Args:
            order_item: Order item for Instagram service
            product: Product details
        """
        tasks = [
            {
                "type": FulfillmentTaskTypeEnum.INSTAGRAM_SETUP,
                "title": "Instagram Account Setup",
                "description": "Connect and verify Instagram account for service delivery",
                "scheduled_at": datetime.utcnow() + timedelta(hours=1),
                "payload": {
                    "action": "account_setup",
                    "product_type": product.title,
                    "order_item_id": str(order_item.id)
                }
            },
            {
                "type": FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                "title": "Initial Analytics Collection",
                "description": "Collect baseline Instagram analytics before service start",
                "scheduled_at": datetime.utcnow() + timedelta(hours=2),
                "payload": {
                    "action": "baseline_analytics",
                    "metrics": ["followers", "engagement", "reach"]
                }
            },
            {
                "type": FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
                "title": "Follower Growth Campaign",
                "description": "Start automated follower growth activities",
                "scheduled_at": datetime.utcnow() + timedelta(hours=24),
                "payload": {
                    "action": "start_growth",
                    "target_growth": self._calculate_growth_targets(order_item),
                    "duration_days": 30
                }
            },
            {
                "type": FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
                "title": "Engagement Enhancement",
                "description": "Implement engagement boosting strategies",
                "scheduled_at": datetime.utcnow() + timedelta(hours=48),
                "payload": {
                    "action": "boost_engagement",
                    "strategies": ["targeted_likes", "relevant_comments", "story_interactions"]
                }
            }
        ]
        
        for task_data in tasks:
            task = FulfillmentTask(
                order_item_id=order_item.id,
                task_type=task_data["type"],
                title=task_data["title"],
                description=task_data["description"],
                payload=task_data["payload"],
                scheduled_at=task_data["scheduled_at"],
                status=FulfillmentTaskStatusEnum.PENDING
            )
            self.db.add(task)
            
        logger.info(
            "Created Instagram fulfillment tasks",
            order_item_id=str(order_item.id),
            tasks_count=len(tasks)
        )
        
    async def _create_generic_fulfillment_tasks(self, order_item: OrderItem, product: Product) -> None:
        """Create generic fulfillment tasks for non-Instagram services.
        
        Args:
            order_item: Order item
            product: Product details
        """
        task = FulfillmentTask(
            order_item_id=order_item.id,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title=f"{product.title} Service Delivery",
            description=f"Execute {product.title} service as configured",
            payload={
                "action": "generic_service",
                "product_type": product.category,
                "service_title": product.title
            },
            scheduled_at=datetime.utcnow() + timedelta(hours=24),
            status=FulfillmentTaskStatusEnum.PENDING
        )
        
        self.db.add(task)
        
        logger.info(
            "Created generic fulfillment task",
            order_item_id=str(order_item.id),
            product_category=product.category
        )

    async def _create_configurable_fulfillment_tasks(self, order_item: OrderItem, product: Product) -> None:
        """Create fulfillment tasks based on per-product configuration."""
        config = product.fulfillment_config or {}
        tasks_config = config.get("tasks")

        if not isinstance(tasks_config, list) or not tasks_config:
            logger.warning(
                "Product fulfillment config missing task definitions",
                product_id=str(product.id),
            )
            await self._create_generic_fulfillment_tasks(order_item, product)
            return

        context = await self._build_task_context(order_item, product)

        created = 0
        for task_index, task_config in enumerate(tasks_config):
            if not isinstance(task_config, dict):
                logger.warning(
                    "Skipping fulfillment task config because it is not a dict",
                    product_id=str(product.id),
                    task_index=task_index,
                )
                continue

            task_type_value = task_config.get("type")
            try:
                task_type = FulfillmentTaskTypeEnum(task_type_value)
            except Exception:
                logger.warning(
                    "Skipping fulfillment task with unsupported type",
                    product_id=str(product.id),
                    task_index=task_index,
                    task_type=task_type_value,
                )
                continue

            scheduled_at = self._resolve_task_schedule(task_config)
            max_retries = self._resolve_max_retries(task_config)

            payload = {
                "execution": task_config.get("execution"),
                "context": context,
                "metadata": task_config.get("metadata"),
                "raw_payload": task_config.get("payload"),
            }

            title = task_config.get("title") or f"{product.title} · {task_type.value.replace('_', ' ').title()}"
            description = task_config.get("description")

            task = FulfillmentTask(
                order_item_id=order_item.id,
                task_type=task_type,
                title=title,
                description=description,
                payload=payload,
                scheduled_at=scheduled_at,
                status=FulfillmentTaskStatusEnum.PENDING,
                max_retries=max_retries,
            )

            self.db.add(task)
            created += 1

        if created == 0:
            logger.warning(
                "No valid fulfillment tasks were created from product configuration; falling back to generic task",
                product_id=str(product.id),
            )
            await self._create_generic_fulfillment_tasks(order_item, product)
            return

        logger.info(
            "Created configured fulfillment tasks",
            order_item_id=str(order_item.id),
            product_id=str(product.id),
            tasks_count=created,
        )
        
    def _calculate_growth_targets(self, order_item: OrderItem) -> Dict[str, Any]:
        """Calculate growth targets based on order item price and options.
        
        Args:
            order_item: Order item to calculate targets for
            
        Returns:
            Dictionary with growth targets
        """
        base_price = float(order_item.unit_price)
        
        # Basic target calculation based on price tiers
        if base_price >= 500:
            return {
                "follower_increase": 2000,
                "engagement_rate_target": 8.0,
                "daily_growth": 65
            }
        elif base_price >= 300:
            return {
                "follower_increase": 1000,
                "engagement_rate_target": 6.0,
                "daily_growth": 35
            }
        else:
            return {
                "follower_increase": 500,
                "engagement_rate_target": 4.0,
                "daily_growth": 20
            }

    async def _build_task_context(self, order_item: OrderItem, product: Product) -> Dict[str, Any]:
        """Return a serializable context snapshot for templating."""
        order = order_item.order
        if order is None and getattr(order_item, "order_id", None):
            order = await self.db.get(Order, order_item.order_id)
        return {
            "order": self._serialize_order(order) if order else None,
            "item": self._serialize_order_item(order_item),
            "product": self._serialize_product(product),
        }

    @staticmethod
    def _resolve_task_schedule(task_config: Dict[str, Any]) -> datetime:
        """Resolve scheduled_at from configuration."""
        offset_seconds = task_config.get("schedule_offset_seconds")
        if isinstance(offset_seconds, (int, float)):
            return datetime.utcnow() + timedelta(seconds=float(offset_seconds))

        offset_minutes = task_config.get("schedule_offset_minutes")
        if isinstance(offset_minutes, (int, float)):
            return datetime.utcnow() + timedelta(minutes=float(offset_minutes))

        offset_hours = task_config.get("schedule_offset_hours")
        if isinstance(offset_hours, (int, float)):
            return datetime.utcnow() + timedelta(hours=float(offset_hours))

        explicit = task_config.get("scheduled_at")
        if isinstance(explicit, str):
            try:
                return datetime.fromisoformat(explicit)
            except ValueError:
                logger.warning("Invalid scheduled_at format in fulfillment config", scheduled_at=explicit)

        return datetime.utcnow()

    @staticmethod
    def _resolve_max_retries(task_config: Dict[str, Any]) -> int:
        """Normalize max retries from configuration."""
        max_retries = task_config.get("max_retries")
        if isinstance(max_retries, int) and max_retries >= 0:
            return max_retries
        if isinstance(max_retries, float) and max_retries >= 0:
            return int(max_retries)
        return 3

    @staticmethod
    def _serialize_order(order: Order | None) -> Dict[str, Any] | None:
        if order is None:
            return None
        # Read datetime fields directly from the instance dict to avoid async lazy-loads
        created_at_val = order.__dict__.get("created_at")
        updated_at_val = order.__dict__.get("updated_at")
        return {
            "id": str(order.id),
            "order_number": order.order_number,
            "user_id": str(order.user_id) if order.user_id else None,
            "status": order.status.value if hasattr(order.status, "value") else order.status,
            "source": order.source.value if hasattr(order.source, "value") else order.source,
            "subtotal": FulfillmentService._decimal_to_float(order.subtotal),
            "tax": FulfillmentService._decimal_to_float(order.tax),
            "total": FulfillmentService._decimal_to_float(order.total),
            "currency": order.currency.value if hasattr(order.currency, "value") else order.currency,
            "notes": order.notes,
            "created_at": created_at_val.isoformat() if created_at_val else None,
            "updated_at": updated_at_val.isoformat() if updated_at_val else None,
        }

    @staticmethod
    def _serialize_order_item(order_item: OrderItem) -> Dict[str, Any]:
        return {
            "id": str(order_item.id),
            "order_id": str(order_item.order_id),
            "product_id": str(order_item.product_id) if order_item.product_id else None,
            "product_title": order_item.product_title,
            "quantity": int(order_item.quantity),
            "unit_price": FulfillmentService._decimal_to_float(order_item.unit_price),
            "total_price": FulfillmentService._decimal_to_float(order_item.total_price),
            "selected_options": order_item.selected_options,
            "attributes": order_item.attributes,
            "created_at": order_item.created_at.isoformat() if order_item.created_at else None,
            "updated_at": order_item.updated_at.isoformat() if order_item.updated_at else None,
        }

    @staticmethod
    def _serialize_product(product: Product) -> Dict[str, Any]:
        return {
            "id": str(product.id),
            "slug": product.slug,
            "title": product.title,
            "category": product.category,
            "base_price": FulfillmentService._decimal_to_float(product.base_price),
            "currency": product.currency.value if hasattr(product.currency, "value") else product.currency,
            "status": product.status.value if hasattr(product.status, "value") else product.status,
        }

    @staticmethod
    def _decimal_to_float(value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except Exception:
            return None
            
    async def get_pending_tasks(self, limit: int = 50) -> List[FulfillmentTask]:
        """Get pending fulfillment tasks ready for processing.
        
        Args:
            limit: Maximum number of tasks to return
            
        Returns:
            List of pending tasks
        """
        stmt = (
            select(FulfillmentTask)
            .options(
                selectinload(FulfillmentTask.order_item).selectinload(OrderItem.order)
            )
            .where(
                FulfillmentTaskStatusEnum.PENDING == FulfillmentTask.status,
                FulfillmentTask.scheduled_at <= datetime.utcnow()
            )
            .order_by(FulfillmentTask.scheduled_at)
            .limit(limit)
        )
        
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
        
    async def update_task_status(
        self,
        task_id: UUID,
        status: FulfillmentTaskStatusEnum,
        result_data: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None
    ) -> bool:
        """Update fulfillment task status and results.
        
        Args:
            task_id: Task ID to update
            status: New task status
            result_data: Task execution results
            error_message: Error message if task failed
            
        Returns:
            True if update successful
        """
        try:
            stmt = (
                select(FulfillmentTask)
                .options(selectinload(FulfillmentTask.order_item))
                .where(FulfillmentTask.id == task_id)
            )
            result = await self.db.execute(stmt)
            task = result.scalar_one_or_none()
            
            if not task:
                return False

            order_item = task.order_item
            order_id: UUID | None = order_item.order_id if order_item else None
                
            task.status = status
            
            if status == FulfillmentTaskStatusEnum.IN_PROGRESS:
                task.started_at = datetime.utcnow()
            elif status in [FulfillmentTaskStatusEnum.COMPLETED, FulfillmentTaskStatusEnum.FAILED]:
                task.completed_at = datetime.utcnow()
                
            if result_data:
                task.result = result_data
                
            if error_message:
                task.error_message = error_message
                task.retry_count += 1

            await self.db.flush()

            if order_id:
                await self._sync_order_status_for_order(order_id)
                
            await self.db.commit()
            await self.db.refresh(task)
            
            logger.info(
                "Updated task status",
                task_id=str(task_id),
                status=status.value,
                has_error=bool(error_message)
            )
            
            return True
            
        except Exception as e:
            logger.error(
                "Failed to update task status",
                task_id=str(task_id),
                error=str(e)
            )
            await self.db.rollback()
            return False

    async def schedule_retry(
        self,
        task: FulfillmentTask,
        delay_seconds: int,
        error_message: str,
    ) -> FulfillmentTask:
        """Schedule a retry for the provided task with exponential backoff."""

        task.status = FulfillmentTaskStatusEnum.PENDING
        task.retry_count += 1
        task.error_message = error_message
        task.result = None
        task.started_at = None
        task.completed_at = None
        task.scheduled_at = datetime.utcnow() + timedelta(seconds=delay_seconds)

        await self.db.commit()
        await self.db.refresh(task)
        await self.db.refresh(task, attribute_names=["order_item"])

        order = None
        if task.order_item is not None:
            await self.db.refresh(task.order_item, attribute_names=["order"])
            order = task.order_item.order

        if order is not None and self.notification_service:
            await self.notification_service.send_fulfillment_retry(order, task)

        logger.warning(
            "Scheduled fulfillment task retry",
            task_id=str(task.id),
            retry_count=task.retry_count,
            max_retries=task.max_retries,
            next_run_at=task.scheduled_at.isoformat() if task.scheduled_at else None,
            delay_seconds=delay_seconds,
        )

        return task
            
    async def get_order_fulfillment_progress(self, order_id: UUID) -> Optional[Dict[str, Any]]:
        """Get fulfillment progress for an order.
        
        Args:
            order_id: Order ID
            
        Returns:
            Dictionary with fulfillment progress information
        """
        try:
            # Get order with items and tasks
            stmt = (
                select(Order)
                .options(
                    selectinload(Order.items).selectinload(OrderItem.fulfillment_tasks)
                )
                .where(Order.id == order_id)
            )
            result = await self.db.execute(stmt)
            order = result.scalar_one_or_none()
            
            if not order:
                return None

            stats = self._calculate_task_stats(order)
            total_tasks = stats["total"]
            completed_tasks = stats["completed"]
            failed_tasks = stats["failed"]
            in_progress_tasks = stats["in_progress"]
            progress_percentage = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
            
            return {
                "order_id": str(order_id),
                "order_status": order.status.value,
                "total_tasks": total_tasks,
                "completed_tasks": completed_tasks,
                "failed_tasks": failed_tasks,
                "in_progress_tasks": in_progress_tasks,
                "progress_percentage": round(progress_percentage, 2),
                "items_count": len(order.items)
            }
            
        except Exception as e:
            logger.error(
                "Failed to get fulfillment progress",
                order_id=str(order_id),
                error=str(e)
            )
            return None

    async def _sync_order_status_for_order(self, order_id: UUID) -> None:
        """Recalculate order status based on fulfillment task state."""
        stmt = (
            select(Order)
            .options(
                selectinload(Order.items).selectinload(OrderItem.fulfillment_tasks)
            )
            .where(Order.id == order_id)
        )
        result = await self.db.execute(stmt)
        order = result.scalar_one_or_none()

        if not order:
            return

        if order.status == OrderStatusEnum.CANCELED:
            return

        stats = self._calculate_task_stats(order)

        if stats["total"] == 0:
            return

        new_status: OrderStatusEnum
        if stats["failed"] > 0:
            new_status = OrderStatusEnum.ON_HOLD
        elif stats["completed"] == stats["total"]:
            new_status = OrderStatusEnum.COMPLETED
        elif stats["in_progress"] > 0 or stats["completed"] > 0:
            new_status = OrderStatusEnum.ACTIVE
        else:
            new_status = OrderStatusEnum.PROCESSING

        if new_status != order.status:
            previous_status = order.status
            order.status = new_status
            await self.db.flush()
            await self.notification_service.send_order_status_update(
                order,
                previous_status=previous_status,
                trigger="fulfillment_progress_update",
            )
            if new_status == OrderStatusEnum.COMPLETED:
                await self.notification_service.send_fulfillment_completion(order)

    @staticmethod
    def _calculate_task_stats(order: Order) -> Dict[str, int]:
        """Aggregate fulfillment task statistics for an order."""
        total_tasks = 0
        completed_tasks = 0
        failed_tasks = 0
        in_progress_tasks = 0

        for item in order.items:
            for task in item.fulfillment_tasks:
                total_tasks += 1
                if task.status == FulfillmentTaskStatusEnum.COMPLETED:
                    completed_tasks += 1
                elif task.status == FulfillmentTaskStatusEnum.FAILED:
                    failed_tasks += 1
                elif task.status == FulfillmentTaskStatusEnum.IN_PROGRESS:
                    in_progress_tasks += 1

        return {
            "total": total_tasks,
            "completed": completed_tasks,
            "failed": failed_tasks,
            "in_progress": in_progress_tasks,
        }
