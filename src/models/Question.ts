import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { CertificationType, DifficultyLevel, QuestionType, SkillSection } from '../types';

interface QuestionAttributes {
  id: string;
  externalId: string | null;   // ID from MCP source
  certification: CertificationType;
  section: SkillSection;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  title: string;
  content: string;             // Main question text / prompt
  mediaUrl: string | null;     // Audio / image URL for listening/speaking
  options: object | null;      // JSON: answer options for MCQ
  correctAnswer: string | null;
  explanation: string | null;
  tags: string[];
  timeAllotted: number | null; // seconds
  marks: number;
  isActive: boolean;
  source: 'MCP' | 'MANUAL';
  mcpFetchedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface QuestionCreationAttributes
  extends Optional<
    QuestionAttributes,
    | 'id'
    | 'externalId'
    | 'mediaUrl'
    | 'options'
    | 'correctAnswer'
    | 'explanation'
    | 'timeAllotted'
    | 'isActive'
    | 'source'
    | 'mcpFetchedAt'
  > {}

export class Question
  extends Model<QuestionAttributes, QuestionCreationAttributes>
  implements QuestionAttributes
{
  declare id: string;
  declare externalId: string | null;
  declare certification: CertificationType;
  declare section: SkillSection;
  declare questionType: QuestionType;
  declare difficulty: DifficultyLevel;
  declare title: string;
  declare content: string;
  declare mediaUrl: string | null;
  declare options: object | null;
  declare correctAnswer: string | null;
  declare explanation: string | null;
  declare tags: string[];
  declare timeAllotted: number | null;
  declare marks: number;
  declare isActive: boolean;
  declare source: 'MCP' | 'MANUAL';
  declare mcpFetchedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Question.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    externalId: { type: DataTypes.STRING, allowNull: true },
    certification: {
      type: DataTypes.ENUM('PTE', 'IELTS', 'TOEFL', 'DUOLINGO'),
      allowNull: false,
    },
    section: {
      type: DataTypes.ENUM('SPEAKING', 'WRITING', 'READING', 'LISTENING'),
      allowNull: false,
    },
    questionType: { type: DataTypes.STRING(80), allowNull: false },
    difficulty: {
      type: DataTypes.ENUM('EASY', 'MEDIUM', 'HARD'),
      defaultValue: 'MEDIUM',
    },
    title: { type: DataTypes.STRING(500), allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    mediaUrl: { type: DataTypes.TEXT, allowNull: true },
    options: { type: DataTypes.JSONB, allowNull: true },
    correctAnswer: { type: DataTypes.TEXT, allowNull: true },
    explanation: { type: DataTypes.TEXT, allowNull: true },
    tags: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
    timeAllotted: { type: DataTypes.INTEGER, allowNull: true },
    marks: { type: DataTypes.FLOAT, defaultValue: 1 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    source: {
      type: DataTypes.ENUM('MCP', 'MANUAL'),
      defaultValue: 'MANUAL',
    },
    mcpFetchedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'questions',
    timestamps: true,
    indexes: [
      { fields: ['certification'] },
      { fields: ['section'] },
      { fields: ['questionType'] },
      { fields: ['difficulty'] },
      { fields: ['isActive'] },
      { fields: ['externalId'] },
    ],
  }
);
