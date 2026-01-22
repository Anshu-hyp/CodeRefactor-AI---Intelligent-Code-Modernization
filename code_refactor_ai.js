import os
import ast
import openai
from typing import Dict, List, Tuple
import subprocess
import json
from pathlib import Path
import git

class CodeRefactorAI:
    def __init__(self, api_key: str):
        openai.api_key = api_key
        self.supported_extensions = ['.py', '.js', '.java', '.cpp', '.go']
    
    def analyze_codebase(self, directory: str) -> Dict:
        """Analyze entire codebase and identify refactoring opportunities"""
        analysis = {
            'files': [],
            'total_lines': 0,
            'issues': [],
            'complexity_score': 0
        }
        
        for root, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules', '__pycache__', 'venv']]
            for file in files:
                ext = Path(file).suffix
                if ext in self.supported_extensions:
                    file_path = os.path.join(root, file)
                    file_analysis = self.analyze_file(file_path)
                    analysis['files'].append(file_analysis)
                    analysis['total_lines'] += file_analysis['lines']
        return analysis
    
    def analyze_file(self, file_path: str) -> Dict:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        ext = Path(file_path).suffix
        analysis = {
            'path': file_path,
            'lines': len(content.split('\n')),
            'issues': [],
            'language': self.get_language(ext)
        }
        
        if ext == '.py':
            analysis.update(self.analyze_python(content))
        return analysis
    
    def analyze_python(self, code: str) -> Dict:
        issues = []
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and not ast.get_docstring(node):
                    issues.append({
                        'type': 'missing_docstring',
                        'line': node.lineno,
                        'name': node.name,
                        'severity': 'medium'
                    })
            
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    func_lines = node.end_lineno - node.lineno
                    if func_lines > 50:
                        issues.append({
                            'type': 'long_function',
                            'line': node.lineno,
                            'name': node.name,
                            'lines': func_lines,
                            'severity': 'high'
                        })
            
            for node in ast.walk(tree):
                depth = self.get_nesting_depth(node)
                if depth > 4:
                    issues.append({
                        'type': 'deep_nesting',
                        'line': getattr(node, 'lineno', 0),
                        'depth': depth,
                        'severity': 'high'
                    })
        except SyntaxError as e:
            issues.append({
                'type': 'syntax_error',
                'line': e.lineno,
                'message': str(e),
                'severity': 'critical'
            })
        return {'issues': issues}
    
    def get_nesting_depth(self, node, depth=0) -> int:
        max_depth = depth
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.If, ast.For, ast.While, ast.With)):
                max_depth = max(max_depth, self.get_nesting_depth(child, depth + 1))
        return max_depth
    
    def get_language(self, ext: str) -> str:
        return {
            '.py': 'python',
            '.js': 'javascript',
            '.java': 'java',
            '.cpp': 'cpp',
            '.go': 'go'
        }.get(ext, 'unknown')
    
    def generate_refactoring_plan(self, file_path: str, issues: List[Dict]) -> Dict:
        with open(file_path, 'r') as f:
            code = f.read()
        
        prompt = f"""Analyze this code and create a refactoring plan:

Issues found: {json.dumps(issues, indent=2)}

Code:
```
{code[:2000]}
```
Return JSON."""
        
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are an expert code refactoring specialist."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )
        return json.loads(response.choices[0].message.content)
    
    def refactor_code(self, file_path: str) -> Tuple[str, List[str]]:
        with open(file_path, 'r') as f:
            original_code = f.read()
        
        prompt = f"""Refactor this code using best practices:

```
{original_code}
```
Return ONLY refactored code."""
        
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a refactoring expert."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2
        )
        
        refactored = response.choices[0].message.content.replace('```python', '').replace('```', '').strip()
        changes = self.summarize_changes(original_code, refactored)
        return refactored, changes
    
    def summarize_changes(self, original: str, refactored: str) -> List[str]:
        changes = []
        if len(original.split('\n')) != len(refactored.split('\n')):
            changes.append("Modified line count")
        if '"""' in refactored and '"""' not in original:
            changes.append("Added docstrings")
        if '->' in refactored and '->' not in original:
            changes.append("Added type hints")
        return changes
