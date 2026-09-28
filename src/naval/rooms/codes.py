import secrets

# No 0/O, 1/I/L: codes are read aloud and typed on phones.
ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6


def new_room_code() -> str:
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


def is_valid_room_code(value: str) -> bool:
    return len(value) == ROOM_CODE_LENGTH and all(char in ROOM_CODE_ALPHABET for char in value)
