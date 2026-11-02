import { StyleSheet, TextInput } from 'react-native';

interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

/**
 * 搜索输入框：纯受控展示组件。
 * 防抖与结果状态由调用方（页面）管理，本组件不接触 Repository / 数据库。
 */
export default function SearchInput({ value, onChangeText, placeholder }: SearchInputProps) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder ?? '搜索标题、内容、标签'}
      returnKeyType="search"
      autoCorrect={false}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
});
