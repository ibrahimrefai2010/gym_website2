CREATE TABLE IF NOT EXISTS roles (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  key_name     VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  description  VARCHAR(500) DEFAULT '',
  is_system    BOOLEAN DEFAULT FALSE,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_roles_active (is_active),
  INDEX idx_roles_system_active (is_system, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  key_name    VARCHAR(120) NOT NULL UNIQUE,
  category    VARCHAR(80) NOT NULL,
  description VARCHAR(500) DEFAULT '',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_permissions_category (category, is_active),
  INDEX idx_permissions_active (is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  granted_by    INT UNSIGNED DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_role_permissions_permission (permission_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_user_roles (
  admin_user_id INT UNSIGNED NOT NULL,
  role_id       INT UNSIGNED NOT NULL,
  granted_by    INT UNSIGNED DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_user_id, role_id),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_admin_user_roles_role (role_id)
) ENGINE=InnoDB;
