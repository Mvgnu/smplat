import uvicorn

from .app import create_app


def main() -> None:
    uvicorn.run("smplat_api.app:create_app", factory=True, reload=True)


if __name__ == "__main__":
    main()
