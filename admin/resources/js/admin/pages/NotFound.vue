<template>
  <div class="page">
    <div class="page-card not-found">
      <el-result icon="warning" title="页面不存在" sub-title="请从左侧菜单进入，或返回工作台。">
        <template #extra>
          <el-button type="primary" @click="$router.replace('/')">返回工作台</el-button>
        </template>
      </el-result>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
