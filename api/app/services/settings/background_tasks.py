from uuid import UUID

from ...extensions import db
from ...models import BackgroundTaskSettings, Conversation, ModelConfiguration, Project
from ..errors import ServiceError
from .queries import models_for_user


def background_task_settings(user_id: UUID) -> BackgroundTaskSettings:
    settings = db.session.get(BackgroundTaskSettings, user_id)
    if settings is None:
        settings = BackgroundTaskSettings(user_id=user_id)
        db.session.add(settings)
        db.session.flush()
    return settings


def serialize_background_tasks(settings: BackgroundTaskSettings) -> dict:
    return {
        "reasoningEfforts": settings.reasoning_efforts,
        "operationApprovalModelId": (
            str(settings.operation_approval_model_id)
            if settings.operation_approval_model_id
            else None
        ),
        "autoSummaryEnabled": settings.auto_summary_enabled,
        "autoSummaryModelId": (
            str(settings.auto_summary_model_id) if settings.auto_summary_model_id else None
        ),
        "contextCompactionThreshold": round(settings.context_compaction_ratio * 100),
        "contextCompactionModelId": (
            str(settings.context_compaction_model_id)
            if settings.context_compaction_model_id
            else None
        ),
        "suggestionsEnabled": settings.suggestions_enabled,
        "suggestionsModelId": (
            str(settings.suggestions_model_id) if settings.suggestions_model_id else None
        ),
    }


def save_background_tasks(user_id: UUID, payload: dict) -> dict:
    settings = background_task_settings(user_id)
    model_ids = {item.id for item in models_for_user(user_id)}

    def model_id(name: str) -> UUID | None:
        value = payload.get(name)
        if value in {None, ""}:
            return None
        try:
            parsed = UUID(str(value))
        except ValueError as error:
            raise ServiceError("validation_error", 422) from error
        if parsed not in model_ids:
            raise ServiceError("validation_error", 422)
        return parsed

    try:
        threshold = float(payload.get("contextCompactionThreshold"))
    except (TypeError, ValueError) as error:
        raise ServiceError("validation_error", 422) from error
    if not 1 <= threshold <= 100:
        raise ServiceError("validation_error", 422)
    settings.auto_summary_enabled = bool(payload.get("autoSummaryEnabled"))
    settings.auto_summary_model_id = model_id("autoSummaryModelId")
    settings.context_compaction_ratio = threshold / 100
    settings.context_compaction_model_id = model_id("contextCompactionModelId")
    settings.suggestions_enabled = bool(payload.get("suggestionsEnabled"))
    settings.suggestions_model_id = model_id("suggestionsModelId")
    settings.operation_approval_model_id = model_id("operationApprovalModelId")
    efforts = payload.get("reasoningEfforts", {})
    if not isinstance(efforts, dict):
        raise ServiceError("validation_error", 422)
    task_models = {
        "operationApproval": settings.operation_approval_model_id,
        "autoSummary": settings.auto_summary_model_id,
        "contextCompaction": settings.context_compaction_model_id,
        "suggestions": settings.suggestions_model_id,
    }
    for task, effort in efforts.items():
        if task not in task_models or not isinstance(effort, str) or len(effort) > 100:
            raise ServiceError("validation_error", 422)
        model = configured_model(user_id, task_models[task])
        if effort and (
            not model or effort not in {level["key"] for level in model.reasoning_levels}
        ):
            raise ServiceError("invalid_reasoning_effort", 422)
    settings.reasoning_efforts = efforts
    db.session.commit()
    return serialize_background_tasks(settings)


def configured_model(user_id: UUID, configured_model_id: UUID | None) -> ModelConfiguration | None:
    models = models_for_user(user_id)
    if configured_model_id:
        return next((item for item in models if item.id == configured_model_id), None)
    return models[0] if models else None


def conversation_user_id(conversation_id: UUID) -> UUID:
    user_id = db.session.scalar(
        db.select(Project.user_id)
        .join(Conversation, Conversation.project_id == Project.id)
        .where(Conversation.id == conversation_id)
    )
    if not user_id:
        raise ServiceError("not_found", 404)
    return user_id


def background_reasoning_effort(
    settings: BackgroundTaskSettings, task: str, model: ModelConfiguration
) -> str:
    effort = settings.reasoning_efforts.get(task, "")
    return (
        effort
        if model.reasoning_enabled
        and any(level["key"] == effort for level in model.reasoning_levels)
        else ""
    )
