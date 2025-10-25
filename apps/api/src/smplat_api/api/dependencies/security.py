from fastapi import Depends, Header, HTTPException, status

from smplat_api.core.settings import settings


async def require_checkout_api_key(x_api_key: str = Header("", alias="X-API-Key")) -> None:
    if not settings.checkout_api_key:
        return

    if x_api_key != settings.checkout_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


def optional_checkout_api_key_dependency() -> Depends:
    return Depends(require_checkout_api_key)
