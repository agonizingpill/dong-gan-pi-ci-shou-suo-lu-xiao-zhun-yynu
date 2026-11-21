import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import session
from .models import User

SECRET = os.getenv('JWT_SECRET', 'demo-freeze-laboratory-evidence-signing-key')
bearer = HTTPBearer(auto_error=False)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f'{salt}:{digest}'


def valid_password(password, stored):
    salt = stored.split(':')[0]
    return hmac.compare_digest(password_hash(password, salt), stored)


def issue(user):
    return jwt.encode(
        {'sub': user.username, 'role': user.role.value, 'exp': datetime.now(timezone.utc) + timedelta(hours=8)},
        SECRET, algorithm='HS256',
    )


def identity(auth: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(session)):
    if auth is not None:
        try:
            claims = jwt.decode(auth.credentials, SECRET, algorithms=['HS256'], options={'require': ['exp', 'sub']})
            user = db.get(User, claims['sub'])
            if user is not None and user.role.value == claims.get('role'):
                return user
        except jwt.InvalidTokenError:
            pass
    raise HTTPException(401, '请登录实验室工作台', headers={'WWW-Authenticate': 'Bearer'})


def require(*roles):
    def check(user=Depends(identity)):
        if user.role not in roles:
            raise HTTPException(403, '当前角色没有该操作权限')
        return user
    return check
