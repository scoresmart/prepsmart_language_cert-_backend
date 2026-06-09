import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { CertificationType, TestStatus } from '../types';
import { User } from './User';
import { Question } from './Question';

// ─── Test (template / mock test definition) ───────────────────────────────────
interface TestAttributes {
  id: string;
  title: string;
  certification: CertificationType;
  description: string | null;
  totalMarks: number;
  durationMinutes: number;
  isPublished: boolean;
  questionIds: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface TestCreationAttributes
  extends Optional<TestAttributes, 'id' | 'description' | 'isPublished'> {}

export class Test
  extends Model<TestAttributes, TestCreationAttributes>
  implements TestAttributes
{
  declare id: string;
  declare title: string;
  declare certification: CertificationType;
  declare description: string | null;
  declare totalMarks: number;
  declare durationMinutes: number;
  declare isPublished: boolean;
  declare questionIds: string[];
  declare createdAt: Date;
  declare updatedAt: Date;
}

Test.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    certification: { type: DataTypes.ENUM('PTE', 'IELTS', 'TOEFL', 'DUOLINGO'), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    totalMarks: { type: DataTypes.FLOAT, allowNull: false },
    durationMinutes: { type: DataTypes.INTEGER, allowNull: false },
    isPublished: { type: DataTypes.BOOLEAN, defaultValue: false },
    questionIds: { type: DataTypes.ARRAY(DataTypes.UUID), defaultValue: [] },
  },
  { sequelize, tableName: 'tests', timestamps: true }
);

// ─── Test Attempt (student's attempt at a test) ───────────────────────────────
interface TestAttemptAttributes {
  id: string;
  userId: string;
  testId: string;
  status: TestStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  totalScore: number | null;
  sectionScores: object | null;  // { SPEAKING: 79, WRITING: 82, ... }
  answers: object | null;        // { [questionId]: { answer, timeTaken } }
  createdAt?: Date;
  updatedAt?: Date;
}

interface TestAttemptCreationAttributes
  extends Optional<
    TestAttemptAttributes,
    'id' | 'startedAt' | 'completedAt' | 'totalScore' | 'sectionScores' | 'answers'
  > {}

export class TestAttempt
  extends Model<TestAttemptAttributes, TestAttemptCreationAttributes>
  implements TestAttemptAttributes
{
  declare id: string;
  declare userId: string;
  declare testId: string;
  declare status: TestStatus;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare totalScore: number | null;
  declare sectionScores: object | null;
  declare answers: object | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

TestAttempt.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    testId: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED'),
      defaultValue: 'NOT_STARTED',
    },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    totalScore: { type: DataTypes.FLOAT, allowNull: true },
    sectionScores: { type: DataTypes.JSONB, allowNull: true },
    answers: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    tableName: 'test_attempts',
    timestamps: true,
    indexes: [{ fields: ['userId'] }, { fields: ['testId'] }, { fields: ['status'] }],
  }
);

// Associations
TestAttempt.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TestAttempt.belongsTo(Test, { foreignKey: 'testId', as: 'test' });
User.hasMany(TestAttempt, { foreignKey: 'userId', as: 'attempts' });
