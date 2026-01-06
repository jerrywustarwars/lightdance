#include <bits/stdc++.h>

using namespace std;

// 符合韌體位元格式的封裝函數
unsigned int toFirmwareInt(int r, int g, int b, int bright6bit, int trans, int dir) {
    unsigned int color24 = ((unsigned int)(r & 0xFF) << 16) |
                           ((unsigned int)(g & 0xFF) << 8)  |
                           ((unsigned int)(b & 0xFF));
    
    // 封裝格式：| 顏色(24bit) | 亮度(6bit) | 轉場(1bit) | 方向(1bit) |
    unsigned int lastByte = ((bright6bit & 0x3F) << 2) | 
                            ((trans & 0x01) << 1) | 
                            (dir & 0x01);
    
    return (color24 << 8) | lastByte;
}

// 線性插值函數：計算兩個顏色中間的數值
int lerp(int start, int end, float fraction) {
    return (int)(start + (end - start) * fraction);
}

int main() {
    srand(time(NULL));
    
    vector<string> bodyParts = {
        "hat", "face", "chestL", "chestR", "armL", "armR", 
        "tie", "belt", "gloveL", "gloveR", "legL", "legR", 
        "shoeL", "shoeR", "board"
    };
    
    int playerCount = 7;
    int dataCount = 20;   // 增加影格數量以觀察漸變效果
    int partCount = bodyParts.size();

    cout << "{\n  \"players\": [\n";

    for (int p = 0; p < playerCount; p++) {
        // 定義起始顏色與結束顏色，讓每個部位產生漸變
        struct Color { int r, g, b; };
        vector<Color> startColors(partCount);
        vector<Color> endColors(partCount);
        
        for(int j = 0; j < partCount; j++) {
            startColors[j] = {rand() % 256, rand() % 256, rand() % 256};
            endColors[j]   = {rand() % 256, rand() % 256, rand() % 256};
        }

        cout << "    [\n";
        for (int i = 0; i < dataCount; i++) {
            // 計算目前影格佔總進度的比例 (0.0 到 1.0)
            float fraction = (float)i / (dataCount - 1);
            
            // 假設每隔 10 個單位時間一個影格 (韌體讀取後會變為 500ms)
            int timeValue = i * 10; 

            cout << "      {\"time\": " << timeValue;
            for (int j = 0; j < partCount; j++) {
                // 根據進度計算 R, G, B 的插值
                int r = lerp(startColors[j].r, endColors[j].r, fraction);
                int g = lerp(startColors[j].g, endColors[j].g, fraction);
                int b = lerp(startColors[j].b, endColors[j].b, fraction);
                
                int brightness = 63; // 固定最大亮度
                int trans = 1;      // 開啟轉場旗標，讓韌體端知道要執行漸變
                int dir = 0;
                
                unsigned int val = toFirmwareInt(r, g, b, brightness, trans, dir);
                
                cout << ", \"" << bodyParts[j] << "\": \"0x" 
                     << hex << uppercase << setw(8) << setfill('0') << val << dec << "\"";
            }
            cout << "}" << (i == dataCount - 1 ? "" : ",") << "\n";
        }
        cout << "    ]" << (p == playerCount - 1 ? "" : ",") << "\n";
    }

    cout << "  ]\n}";
    return 0;
}