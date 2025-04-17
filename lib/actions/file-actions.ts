'use server';

import { db } from '@/lib/db/drizzle';
import { auditUnits, files } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getUser } from '@/lib/db/queries';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import OSS from 'ali-oss';
import { createStorage, StorageProvider } from '@/lib/file-storage';
import postgres from 'postgres';
import { initializeOnce } from '../server/initialize';

export interface FileResponse {
  id: string;
  filename: string;
  size: number;
  type: string;
  url: string;
  createdAt: string;
  uploadedBy?: string;
  isAnalyzed: boolean;
}

/**
 * 获取项目文件列表
 */
export async function getProjectFiles(projectId: string): Promise<FileResponse[]> {
  try {
    const user = await getUser();
    if (!user) {
      throw new Error('未授权访问');
    }

    // 检查被审计单位是否存在
    const auditUnit = await db.query.auditUnits.findFirst({
      where: eq(auditUnits.id, projectId),
    });

    if (!auditUnit) {
      throw new Error('被审计单位不存在');
    }
    
    // 获取被审计单位的文件
    const filesList = await db.query.files.findMany({
      where: eq(files.auditUnitId, projectId),
      orderBy: (files, { desc }) => [desc(files.uploadDate)],
      with: {
        uploadedBy: {
          columns: {
            name: true,
          }
        }
      }
    });

    // 格式化响应
    return filesList.map(file => ({
      id: file.id,
      filename: file.originalName,
      size: Number(file.fileSize),
      type: file.fileType,
      url: file.filePath,
      createdAt: file.uploadDate?.toISOString() || new Date().toISOString(),
      uploadedBy: file.uploadedBy?.name || '未知用户',
      isAnalyzed: !!file.isAnalyzed
    }));
  } catch (error) {
    console.error('获取文件列表失败:', error);
    throw error;
  }
}

/**
 * 系统初始化函数，确保数据库结构正确
 * 在应用启动时自动执行
 */
export async function initializeStorageSystem() {
  console.log('正在初始化文件存储系统...');
  
  try {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      console.error('未设置POSTGRES_URL环境变量');
      return false;
    }
    
    // 使用全局连接池而非创建新连接
    try {
      // 使用已有的db实例
      const { getDb } = await import('../db/drizzle');
      const db = getDb();
      
      // 检查storage_provider列是否存在
      const storageProviderResult = await db.execute(sql`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'storage_provider';
      `);
      
      // 如果不存在，添加列
      if (!storageProviderResult.length) {
        console.log('添加 storage_provider 列...');
        await db.execute(sql`
          ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_provider TEXT;
        `);
      }
      
      // 检查storage_path列是否存在
      const storagePathResult = await db.execute(sql`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'files' AND column_name = 'storage_path';
      `);
      
      // 如果不存在，添加列
      if (!storagePathResult.length) {
        console.log('添加 storage_path 列...');
        await db.execute(sql`
          ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_path TEXT;
        `);
      }
      
      console.log('文件存储系统初始化完成');
      return true;
    } catch (dbError) {
      console.error('数据库初始化失败:', dbError);
      return false;
    }
  } catch (error) {
    console.error('初始化存储系统失败:', error);
    return false;
  }
}

/**
 * 安全的初始化函数，使用通用初始化工具
 * 确保在应用生命周期内只执行一次初始化
 */
export async function safeInitializeStorageSystem() {
  return initializeOnce('storage-system', async () => {
    console.log('开始初始化存储系统...');
    return initializeStorageSystem();
  }, {
    logPrefix: '[STORAGE-INIT]'
  });
}

/**
 * 上传文件到项目
 */
export async function uploadProjectFiles(
  formData: FormData
): Promise<{files: FileResponse[]}> {
  try {
    const user = await getUser();
    if (!user) {
      throw new Error('未授权访问');
    }

    const projectId = formData.get('projectId') as string;
    if (!projectId) {
      throw new Error('项目ID不能为空');
    }

    // 检查被审计单位是否存在
    const auditUnit = await db.query.auditUnits.findFirst({
      where: eq(auditUnits.id, projectId),
    });

    if (!auditUnit) {
      throw new Error('被审计单位不存在');
    }

    const uploadedFiles = formData.getAll('files') as File[];
    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw new Error('没有上传文件');
    }

    // 创建存储服务实例（根据环境变量会自动选择OSS或本地存储）
    const storage = createStorage();
    const isOssStorage = process.env.STORAGE_PROVIDER === StorageProvider.ALIYUN_OSS;
    console.log('使用存储类型:', isOssStorage ? 'OSS存储' : '本地存储');
    
    const savedFiles: FileResponse[] = [];
    
    for (const file of uploadedFiles) {
      const fileId = randomUUID();
      
      let filePath = '';
      let publicUrl = '';
      
      // 使用存储服务上传文件
      try {
        // 上传文件并获取结果
        const result = await storage.uploadFile(file, fileId);
        filePath = result.path;  // OSS中的对象路径或本地文件路径
        publicUrl = result.url;  // 文件的访问URL
        
        console.log('文件上传成功:', {
          fileId,
          filePath,
          publicUrl,
          provider: result.provider
        });
      } catch (uploadError) {
        console.error('文件上传失败:', uploadError);
        throw new Error(`文件 ${file.name} 上传失败: ${uploadError instanceof Error ? uploadError.message : '未知错误'}`);
      }
      
      // 创建文件记录
      const newFile = await db.insert(files).values({
        name: fileId,
        originalName: file.name,
        filePath: publicUrl, // 存储文件的访问URL
        fileSize: Number(file.size),
        fileType: file.type,
        uploadDate: new Date(),
        userId: user.id,
        auditUnitId: projectId,
        isAnalyzed: false,
        metadata: JSON.stringify({
          storageProvider: isOssStorage ? 'aliyun_oss' : 'local',
          storagePath: filePath
        })
      }).returning();
      
      if (newFile[0]) {
        savedFiles.push({
          id: newFile[0].id,
          filename: newFile[0].originalName,
          size: Number(newFile[0].fileSize),
          type: newFile[0].fileType,
          url: newFile[0].filePath,
          createdAt: newFile[0].uploadDate?.toISOString() || new Date().toISOString(),
          isAnalyzed: false
        });
      }
    }
    
    // 刷新项目页面的缓存
    revalidatePath(`/projects/${projectId}`);
    
    return { files: savedFiles };
  } catch (error) {
    console.error('上传文件失败:', error);
    throw error;
  }
}

/**
 * 删除项目文件
 */
export async function deleteProjectFile(
  projectId: string, 
  fileId: string
): Promise<{ success: boolean }> {
  try {
    const user = await getUser();
    if (!user) {
      throw new Error('未授权访问');
    }

    // 检查被审计单位是否存在
    const auditUnit = await db.query.auditUnits.findFirst({
      where: eq(auditUnits.id, projectId),
    });

    if (!auditUnit) {
      throw new Error('被审计单位不存在');
    }

    // 获取文件信息
    const fileInfo = await db.query.files.findFirst({
      where: and(
        eq(files.id, fileId),
        eq(files.auditUnitId, projectId)
      ),
    });

    if (!fileInfo) {
      throw new Error('文件不存在');
    }

    // 删除数据库记录
    await db.delete(files).where(
      and(
        eq(files.id, fileId),
        eq(files.auditUnitId, projectId)
      )
    );

    // 创建存储服务实例
    const storage = createStorage();
    
    // 尝试删除文件
    try {
      // 获取文件ID和存储路径
      const fileIdForStorage = fileInfo.name;  // 用作存储的文件ID
      let storagePath = fileInfo.filePath;
      
      // 尝试从metadata解析存储信息
      if (fileInfo.metadata) {
        try {
          const metadata = JSON.parse(fileInfo.metadata);
          if (metadata.storagePath) {
            storagePath = metadata.storagePath;
          }
        } catch (e) {
          console.warn('解析文件元数据失败:', e);
        }
      }
      
      // 删除存储中的文件
      await storage.deleteFile(fileIdForStorage, storagePath);
      console.log('文件删除成功:', {fileId, storagePath});
    } catch (fileError) {
      // 文件删除失败不影响整体流程，只记录日志
      console.error('文件删除失败:', fileError);
    }

    // 刷新项目页面的缓存
    revalidatePath(`/projects/${projectId}`);
    
    return { success: true };
  } catch (error) {
    console.error('删除文件失败:', error);
    throw error;
  }
}

/**
 * 更新文件分析状态
 */
export async function updateFileAnalysisStatus(
  projectId: string, 
  fileId: string, 
  isAnalyzed: boolean
): Promise<FileResponse> {
  try {
    const user = await getUser();
    if (!user) {
      throw new Error('未授权访问');
    }

    // 检查被审计单位是否存在
    const auditUnit = await db.query.auditUnits.findFirst({
      where: eq(auditUnits.id, projectId),
    });

    if (!auditUnit) {
      throw new Error('被审计单位不存在');
    }

    // 获取文件信息
    const fileInfo = await db.query.files.findFirst({
      where: and(
        eq(files.id, fileId),
        eq(files.auditUnitId, projectId)
      ),
    });

    if (!fileInfo) {
      throw new Error('文件不存在');
    }

    // 更新文件分析状态
    await db.update(files)
      .set({ isAnalyzed })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.auditUnitId, projectId)
        )
      );

    // 获取更新后的文件
    const updatedFile = await db.query.files.findFirst({
      where: and(
        eq(files.id, fileId),
        eq(files.auditUnitId, projectId)
      ),
      with: {
        uploadedBy: {
          columns: {
            name: true,
          }
        }
      }
    });

    if (!updatedFile) {
      throw new Error('文件更新失败');
    }

    // 刷新项目页面的缓存
    revalidatePath(`/projects/${projectId}`);

    // 格式化响应
    return {
      id: updatedFile.id,
      filename: updatedFile.originalName,
      size: Number(updatedFile.fileSize),
      type: updatedFile.fileType,
      url: updatedFile.filePath,
      createdAt: updatedFile.uploadDate?.toISOString() || new Date().toISOString(),
      uploadedBy: updatedFile.uploadedBy?.name || '未知用户',
      isAnalyzed: !!updatedFile.isAnalyzed
    };
  } catch (error) {
    console.error('更新文件失败:', error);
    throw error;
  }
}

/**
 * 获取单个文件信息
 */
export async function getFile(fileId: string): Promise<FileResponse | null> {
  try {
    const user = await getUser();
    if (!user) {
      throw new Error('未授权访问');
    }

    // 获取文件信息
    const fileInfo = await db.query.files.findFirst({
      where: eq(files.id, fileId),
      with: {
        uploadedBy: {
          columns: {
            name: true,
          }
        }
      }
    });

    if (!fileInfo) {
      return null;
    }

    // 格式化响应
    return {
      id: fileInfo.id,
      filename: fileInfo.originalName,
      size: Number(fileInfo.fileSize),
      type: fileInfo.fileType,
      url: fileInfo.filePath,
      createdAt: fileInfo.uploadDate?.toISOString() || new Date().toISOString(),
      uploadedBy: fileInfo.uploadedBy?.name || '未知用户',
      isAnalyzed: !!fileInfo.isAnalyzed
    };
  } catch (error) {
    console.error(`获取文件[${fileId}]信息失败:`, error);
    throw error;
  }
} 