import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { UserRole } from '../types';

interface UserAttributes {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isVerified: boolean;
  targetCertification: string | null;
  targetScore: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserCreationAttributes
  extends Optional<UserAttributes, 'id' | 'isVerified' | 'targetCertification' | 'targetScore'> {}

export class User
  extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes
{
  declare id: string;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare role: UserRole;
  declare isVerified: boolean;
  declare targetCertification: string | null;
  declare targetScore: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  toSafeJSON() {
    const { passwordHash, ...safe } = this.toJSON() as UserAttributes;
    return safe;
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM('STUDENT', 'TEACHER', 'ADMIN'),
      defaultValue: 'STUDENT',
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    targetCertification: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    targetScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
    indexes: [{ unique: true, fields: ['email'] }],
  }
);
